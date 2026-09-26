import { getGeminiClient, executeWithGeminiPool } from '@/models/gemini';
import { isProviderBlocked, blockProviderUntilTomorrow, isQuotaExhaustedError } from '@/models/registry';

export interface DocumentMetadata {
  sectionId?: string | number;
  sectionName?: string;
  chapter?: string | number;
  topic?: string;
  docId?: string;
  courseId?: string | number;
  courseCode?: string;
}

export interface DocumentChunk {
  id: string;
  docTitle: string;
  text: string;
  chunkIndex: number;
  totalChunks: number;
  embedding?: number[];
  similarityScore?: number;
  metadata?: DocumentMetadata;
}

export interface RawDocument {
  title: string;
  text: string;
  metadata?: DocumentMetadata;
}

export interface RetrievalOptions {
  topK?: number;
  maxTotalChars?: number;
  minSimilarity?: number;
  chunkSize?: number;
  chunkOverlap?: number;
  // Metadata Filtering options
  filterSectionId?: string | number;
  filterSectionName?: string;
  filterChapter?: string | number;
  filterDocTitles?: string[];
  // Dynamic Top-K options
  dynamicTopK?: boolean;
  highConfidenceThreshold?: number;
}

// In-memory document chunk & embedding cache: hash -> DocumentChunk[]
const MAX_CACHED_DOCS = 50;
const documentIndexCache = new Map<string, DocumentChunk[]>();

/**
 * Clears document chunks & vector embeddings from RAM.
 * If docTitleOrPattern is given, only clears matching documents.
 * Otherwise, purges the entire in-memory vector cache.
 */
export function clearRagCache(docTitleOrPattern?: string): number {
  if (!docTitleOrPattern) {
    const count = documentIndexCache.size;
    documentIndexCache.clear();
    return count;
  }

  const lower = docTitleOrPattern.toLowerCase();
  let deletedCount = 0;

  for (const [key, chunks] of documentIndexCache.entries()) {
    const matchesKey = key.toLowerCase().includes(lower);
    const matchesDoc = chunks.some(c => c.docTitle.toLowerCase().includes(lower));
    if (matchesKey || matchesDoc) {
      documentIndexCache.delete(key);
      deletedCount++;
    }
  }

  return deletedCount;
}

/**
 * Ensures memory usage remains bounded by evicting oldest documents if threshold is reached.
 */
function evictOldestIfNeeded(): void {
  if (documentIndexCache.size >= MAX_CACHED_DOCS) {
    const firstKey = documentIndexCache.keys().next().value;
    if (firstKey) {
      documentIndexCache.delete(firstKey);
    }
  }
}

/**
 * Generates a simple hash string for document title + content
 */
function hashDocument(title: string, text: string): string {
  let hash = 0;
  const str = `${title}:::${text.length}:::${text.slice(0, 200)}:::${text.slice(-200)}`;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return `doc_${Math.abs(hash)}`;
}

/**
 * Extracts chapter or section number from title or text (e.g. "Chương 3", "Bài 2", "Chapter 4")
 */
export function extractChapterNumber(text: string): string | null {
  if (!text) return null;
  const match = text.match(/(?:chương|chuong|bài|bai|chapter|section|ch)\s*([0-9]+|[ivxlcdm]+)/i);
  return match ? match[1].toLowerCase() : null;
}

/**
 * Splits document text into overlapping chunks, respecting paragraph and sentence boundaries.
 */
export function chunkDocument(
  text: string,
  docTitle: string,
  options: { chunkSize?: number; chunkOverlap?: number; metadata?: DocumentMetadata } = {}
): DocumentChunk[] {
  const chunkSize = options.chunkSize || 650;
  const chunkOverlap = options.chunkOverlap || 120;

  const meta: DocumentMetadata = {
    ...options.metadata,
    chapter: options.metadata?.chapter || extractChapterNumber(docTitle) || undefined,
  };

  const cleanText = text.replace(/\r\n/g, '\n').trim();
  if (!cleanText) return [];

  // If text is smaller than chunk size, return as a single chunk
  if (cleanText.length <= chunkSize) {
    return [
      {
        id: `${docTitle}_chunk_0`,
        docTitle,
        text: cleanText,
        chunkIndex: 0,
        totalChunks: 1,
        metadata: meta,
      },
    ];
  }

  // Split by double newlines (paragraphs), then lines, then sentences
  const paragraphs = cleanText.split(/\n\s*\n/);
  const rawSegments: string[] = [];

  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (!trimmed) continue;
    if (trimmed.length <= chunkSize) {
      rawSegments.push(trimmed);
    } else {
      // Split large paragraph by single newline or sentence punctuation (. ! ? ;)
      const sentences = trimmed.split(/(?<=[.!?;\n])\s+/);
      let currentBuf = '';
      for (const sent of sentences) {
        if (!sent) continue;
        if ((currentBuf + ' ' + sent).length > chunkSize && currentBuf) {
          rawSegments.push(currentBuf.trim());
          currentBuf = sent;
        } else {
          currentBuf = currentBuf ? `${currentBuf} ${sent}` : sent;
        }
      }
      if (currentBuf.trim()) {
        rawSegments.push(currentBuf.trim());
      }
    }
  }

  // Combine raw segments into target chunk size with overlap
  const chunks: string[] = [];
  let currentChunk = '';

  for (let i = 0; i < rawSegments.length; i++) {
    const seg = rawSegments[i];
    if (!currentChunk) {
      currentChunk = seg;
    } else if ((currentChunk + '\n\n' + seg).length <= chunkSize) {
      currentChunk = `${currentChunk}\n\n${seg}`;
    } else {
      chunks.push(currentChunk);
      // Create overlap from the end of currentChunk
      const words = currentChunk.split(/\s+/);
      const overlapWords = words.slice(-Math.min(words.length, Math.floor(chunkOverlap / 6))).join(' ');
      currentChunk = overlapWords ? `${overlapWords}\n\n${seg}` : seg;
    }
  }

  if (currentChunk.trim() && !chunks.includes(currentChunk)) {
    chunks.push(currentChunk.trim());
  }

  return chunks.map((chunkText, idx) => ({
    id: `${docTitle}_chunk_${idx}`,
    docTitle,
    text: chunkText,
    chunkIndex: idx,
    totalChunks: chunks.length,
    metadata: meta,
  }));
}

/**
 * Computes Cosine Similarity between two numeric vectors.
 */
export function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (!vecA || !vecB || vecA.length === 0 || vecB.length === 0 || vecA.length !== vecB.length) {
    return 0;
  }
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Tokenizes text for BM25/TF-IDF similarity fallback
 */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(t => t.length > 1);
}

/**
 * In-memory BM25 / TF-IDF keyword vector similarity fallback
 */
function computeBM25Score(queryTokens: string[], chunkText: string): number {
  if (queryTokens.length === 0) return 0;
  const chunkTokens = tokenize(chunkText);
  if (chunkTokens.length === 0) return 0;

  const chunkFreqMap = new Map<string, number>();
  for (const token of chunkTokens) {
    chunkFreqMap.set(token, (chunkFreqMap.get(token) || 0) + 1);
  }

  let score = 0;
  const k1 = 1.2;
  const b = 0.75;
  const avgDocLen = 80;
  const docLen = chunkTokens.length;

  for (const qToken of queryTokens) {
    const tf = chunkFreqMap.get(qToken) || 0;
    if (tf > 0) {
      // BM25 term weighting
      const idf = Math.log(1 + 10 / 1); // standard boost for present query terms
      const numerator = tf * (k1 + 1);
      const denominator = tf + k1 * (1 - b + b * (docLen / avgDocLen));
      score += idf * (numerator / denominator);
    }
  }

  // Normalize score between 0 and 1
  return Math.min(1, score / (queryTokens.length * 2.5));
}

/**
 * Generates vector embeddings for a list of texts using Gemini, OpenAI, or falls back to BM25.
 */
export async function generateEmbeddings(texts: string[]): Promise<Array<number[] | null>> {
  if (!texts || texts.length === 0) return [];

  // 1. Try Gemini embedding if not blocked
  if (!isProviderBlocked('gemini')) {
    try {
      const results: Array<number[] | null> = [];
      // Process in small batches of 8 to prevent rate limit
      for (let i = 0; i < texts.length; i += 8) {
        const batch = texts.slice(i, i + 8);
        const batchRes = await executeWithGeminiPool(async (client) => {
          const batchPromises = batch.map(async text => {
            try {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const res = await (client.models as any).embedContent({
                model: 'gemini-embedding-001',
                contents: text.slice(0, 2048),
                config: {
                  outputDimensionality: 768,
                },
              });
              const vec = res.embeddings?.[0]?.values || res.embedding?.values || null;
              return (vec as number[]) || null;
            } catch (innerErr) {
              if (isQuotaExhaustedError(innerErr)) {
                throw innerErr; // trigger key rotation in executeWithGeminiPool
              }
              try {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const fbRes = await (client.models as any).embedContent({
                  model: 'text-embedding-004',
                  contents: text.slice(0, 2048),
                });
                const vec = fbRes.embeddings?.[0]?.values || fbRes.embedding?.values || null;
                return (vec as number[]) || null;
              } catch {
                return null;
              }
            }
          });
          return await Promise.all(batchPromises);
        });
        results.push(...batchRes);
      }

      if (results.some(r => r !== null)) {
        return results;
      }
    } catch (err) {
      if (isQuotaExhaustedError(err)) {
        blockProviderUntilTomorrow('gemini', String(err));
      }
      console.warn('Gemini embedding failed, falling back to BM25:', err);
    }
  }

  // If embedding API is unreachable, return array of nulls (retrieval will seamlessly use BM25)
  return texts.map(() => null);
}

/**
 * Indexes documents into memory chunks and calculates vector embeddings.
 */
/**
 * Indexes documents into memory chunks and calculates vector embeddings.
 */
export async function indexDocuments(rawDocs: RawDocument[], options: RetrievalOptions = {}): Promise<DocumentChunk[]> {
  const allChunks: DocumentChunk[] = [];
  const chunksToEmbed: DocumentChunk[] = [];

  for (const doc of rawDocs) {
    if (!doc.text || !doc.text.trim()) continue;
    const docHash = hashDocument(doc.title, doc.text);

    if (documentIndexCache.has(docHash)) {
      const cached = documentIndexCache.get(docHash)!;
      if (doc.metadata) {
        cached.forEach(c => {
          c.metadata = { ...c.metadata, ...doc.metadata };
        });
      }
      allChunks.push(...cached);
    } else {
      evictOldestIfNeeded();
      const chunks = chunkDocument(doc.text, doc.title, {
        chunkSize: options.chunkSize || 650,
        chunkOverlap: options.chunkOverlap || 120,
        metadata: doc.metadata,
      });
      documentIndexCache.set(docHash, chunks);
      allChunks.push(...chunks);
      chunksToEmbed.push(...chunks);
    }
  }

  // Generate embeddings for newly created chunks
  if (chunksToEmbed.length > 0) {
    try {
      const texts = chunksToEmbed.map(c => `${c.docTitle}\n${c.text}`);
      const embeddings = await generateEmbeddings(texts);
      for (let i = 0; i < chunksToEmbed.length; i++) {
        if (embeddings[i]) {
          chunksToEmbed[i].embedding = embeddings[i]!;
        }
      }
    } catch (err) {
      console.warn('Batch embedding index warning:', err);
    }
  }

  return allChunks;
}

/**
 * Performs Semantic + BM25 Hybrid Similarity Search with Metadata Filtering
 * and Dynamic Top-K Cutoff Thresholding.
 */
export async function retrieveRelevantChunks(
  query: string,
  rawDocs: RawDocument[],
  options: RetrievalOptions = {}
): Promise<DocumentChunk[]> {
  const cleanQuery = (query || '').trim();
  if (!cleanQuery || rawDocs.length === 0) return [];

  const maxTotalChars = options.maxTotalChars || 12000;

  // 1. Index and get all chunks
  const allChunks = await indexDocuments(rawDocs, options);
  if (allChunks.length === 0) return [];

  // 2. Metadata Filtering (Phân vùng tìm kiếm theo Chapter / Section / Topic)
  let candidateChunks = allChunks;
  const targetSectionId = options.filterSectionId;
  const targetSectionName = options.filterSectionName?.toLowerCase();
  const queryChapter = extractChapterNumber(cleanQuery);
  const targetChapter = options.filterChapter ? String(options.filterChapter).toLowerCase() : queryChapter;

  if (
    targetSectionId !== undefined ||
    targetSectionName ||
    targetChapter ||
    (options.filterDocTitles && options.filterDocTitles.length > 0)
  ) {
    const filtered = allChunks.filter(chunk => {
      const meta = chunk.metadata;
      // Filter by doc titles if provided
      if (options.filterDocTitles && options.filterDocTitles.length > 0) {
        const matchesDoc = options.filterDocTitles.some(dt =>
          chunk.docTitle.toLowerCase().includes(dt.toLowerCase())
        );
        if (!matchesDoc) return false;
      }
      // Filter by sectionId
      if (targetSectionId !== undefined && meta?.sectionId !== undefined) {
        if (String(meta.sectionId) === String(targetSectionId)) return true;
      }
      // Filter by chapter
      if (targetChapter) {
        const chunkChap = meta?.chapter ? String(meta.chapter).toLowerCase() : null;
        if (chunkChap === targetChapter) return true;
        const lowerTitle = chunk.docTitle.toLowerCase();
        if (
          lowerTitle.includes(`chương ${targetChapter}`) ||
          lowerTitle.includes(`chuong ${targetChapter}`) ||
          lowerTitle.includes(`chapter ${targetChapter}`) ||
          lowerTitle.includes(`bài ${targetChapter}`) ||
          lowerTitle.includes(`bai ${targetChapter}`)
        ) {
          return true;
        }
      }
      // Filter by sectionName
      if (targetSectionName && meta?.sectionName) {
        if (meta.sectionName.toLowerCase().includes(targetSectionName)) return true;
      }
      return false;
    });

    if (filtered.length > 0) {
      console.log(
        `[RAG Metadata Filter] Restricted vector search from ${allChunks.length} down to ${filtered.length} chunks (Target: ${
          targetChapter ? `Chương ${targetChapter}` : targetSectionName || targetSectionId
        })`
      );
      candidateChunks = filtered;
    }
  }

  // 3. Generate embedding for user query
  let queryEmbedding: number[] | null = null;
  try {
    const [qEmb] = await generateEmbeddings([cleanQuery]);
    queryEmbedding = qEmb;
  } catch {
    queryEmbedding = null;
  }

  return scoreAndSelectChunks(candidateChunks, cleanQuery, options, queryEmbedding);
}

/**
 * Scores candidate chunks (Hybrid Semantic + BM25) and selects the best matching chunks
 * using Dynamic Top-K cut-off thresholding.
 */
export function scoreAndSelectChunks(
  candidateChunks: DocumentChunk[],
  query: string,
  options: RetrievalOptions = {},
  queryEmbedding?: number[] | null
): DocumentChunk[] {
  const cleanQuery = (query || '').trim();
  if (!cleanQuery || candidateChunks.length === 0) return [];

  const maxTotalChars = options.maxTotalChars || 12000;
  const queryTokens = tokenize(cleanQuery);

  // Score candidate chunks (Hybrid Semantic + BM25)
  const scoredChunks: DocumentChunk[] = candidateChunks.map(chunk => {
    let semanticScore = 0;
    if (queryEmbedding && chunk.embedding) {
      semanticScore = cosineSimilarity(queryEmbedding, chunk.embedding);
    }

    const bm25Score = computeBM25Score(queryTokens, `${chunk.docTitle} ${chunk.text}`);

    // If semantic embedding exists, 75% vector similarity + 25% keyword match
    const finalScore = queryEmbedding && chunk.embedding
      ? semanticScore * 0.75 + bm25Score * 0.25
      : bm25Score;

    return {
      ...chunk,
      similarityScore: Math.round(finalScore * 1000) / 1000,
    };
  });

  // Sort by score descending
  scoredChunks.sort((a, b) => (b.similarityScore || 0) - (a.similarityScore || 0));

  const topScore = scoredChunks[0]?.similarityScore || 0;

  // Dynamic Top-K Decision:
  // - If topScore >= 0.88: 1 chunk is enough (laser-focused, zero noise, ~80% token savings!)
  // - If topScore >= 0.80: 2 chunks at most (high confidence)
  // - If topScore >= 0.65: 3 chunks
  // - Otherwise: 3 to 4 chunks max
  let dynamicK = options.topK || 5;
  if (options.dynamicTopK !== false) {
    if (topScore >= 0.88) {
      dynamicK = 1;
      console.log(`[Dynamic Top-K] Laser focus: topScore = ${topScore} >= 0.88 -> Selected top 1 chunk (saves ~80% prompt tokens)`);
    } else if (topScore >= 0.80) {
      dynamicK = 2;
      console.log(`[Dynamic Top-K] High confidence: topScore = ${topScore} >= 0.80 -> Selected top 2 chunks`);
    } else if (topScore >= 0.65) {
      dynamicK = 3;
    } else {
      dynamicK = Math.min(dynamicK, 4);
    }
  }

  const cutoffThreshold = options.minSimilarity ?? 0.80;
  const selected: DocumentChunk[] = [];
  let accumulatedChars = 0;

  for (const chunk of scoredChunks) {
    if (selected.length >= dynamicK) break;
    const score = chunk.similarityScore || 0;

    // Strict Cutoff Rule:
    // If topScore >= 0.80, only accept chunks that are also high confidence (>= 0.75 and within 15% of topScore)
    // Otherwise, accept if score >= cutoffThreshold or pick the single best chunk if below
    const passes = topScore >= 0.80
      ? score >= 0.75 && score >= topScore * 0.85
      : score >= cutoffThreshold || (selected.length === 0 && score >= 0.25);

    if (passes) {
      if (accumulatedChars + chunk.text.length <= maxTotalChars) {
        selected.push(chunk);
        accumulatedChars += chunk.text.length;
      }
    }
  }

  // Safety fallback: if nothing qualified, take the single best chunk
  if (selected.length === 0 && scoredChunks.length > 0) {
    selected.push(scoredChunks[0]);
  }

  console.log(
    `[RAG Result] Query: "${cleanQuery.slice(0, 35)}..." -> Yielded ${selected.length} chunk(s) (topScore: ${topScore}, totalChars: ${accumulatedChars})`
  );
  return selected;
}

/**
 * Formats retrieved chunks into a clean, structured context string for LLM prompts.
 */
export function formatChunksForPrompt(chunks: DocumentChunk[]): string {
  if (!chunks || chunks.length === 0) return '';

  return chunks
    .filter(chunk => chunk.text && chunk.text.trim().length > 20)
    .map(
      (chunk, idx) =>
        `[ĐOẠN TRÍCH TÀI LIỆU ${idx + 1}: "${chunk.docTitle}"]\n${chunk.text.trim()}`
    )
    .join('\n\n');
}

