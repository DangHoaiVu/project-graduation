import { getGeminiClient } from '@/models/gemini';
import { isProviderBlocked, blockProviderUntilTomorrow, isQuotaExhaustedError } from '@/models/registry';

export interface DocumentChunk {
  id: string;
  docTitle: string;
  text: string;
  chunkIndex: number;
  totalChunks: number;
  embedding?: number[];
  similarityScore?: number;
}

export interface RawDocument {
  title: string;
  text: string;
}

export interface RetrievalOptions {
  topK?: number;
  maxTotalChars?: number;
  minSimilarity?: number;
  chunkSize?: number;
  chunkOverlap?: number;
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
 * Splits document text into overlapping chunks, respecting paragraph and sentence boundaries.
 */
export function chunkDocument(
  text: string,
  docTitle: string,
  options: { chunkSize?: number; chunkOverlap?: number } = {}
): DocumentChunk[] {
  const chunkSize = options.chunkSize || 650;
  const chunkOverlap = options.chunkOverlap || 120;

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

  // 1. Try Gemini text-embedding-004 if not blocked
  if (!isProviderBlocked('gemini')) {
    const gemini = getGeminiClient();
    if (gemini) {
      try {
        const results: Array<number[] | null> = [];
        // Process in small batches of 8 to prevent rate limit
        for (let i = 0; i < texts.length; i += 8) {
          const batch = texts.slice(i, i + 8);
          const batchPromises = batch.map(async text => {
            try {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const res = await (gemini.models as any).embedContent({
                model: 'text-embedding-004',
                contents: text.slice(0, 2048),
              });
              return (res.embedding?.values as number[]) || null;
            } catch (innerErr) {
              if (isQuotaExhaustedError(innerErr)) {
                blockProviderUntilTomorrow('gemini', 'Embedding quota exceeded');
              }
              return null;
            }
          });
          const batchRes = await Promise.all(batchPromises);
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
  }

  // If embedding API is unreachable, return array of nulls (retrieval will seamlessly use BM25)
  return texts.map(() => null);
}

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
      allChunks.push(...documentIndexCache.get(docHash)!);
    } else {
      evictOldestIfNeeded();
      const chunks = chunkDocument(doc.text, doc.title, {
        chunkSize: options.chunkSize || 650,
        chunkOverlap: options.chunkOverlap || 120,
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
 * Performs Semantic + BM25 Hybrid Similarity Search to retrieve top-K relevant chunks for a given query.
 */
export async function retrieveRelevantChunks(
  query: string,
  rawDocs: RawDocument[],
  options: RetrievalOptions = {}
): Promise<DocumentChunk[]> {
  const cleanQuery = (query || '').trim();
  if (!cleanQuery || rawDocs.length === 0) return [];

  const topK = options.topK || 6;
  const maxTotalChars = options.maxTotalChars || 14000;
  const minSimilarity = options.minSimilarity ?? 0.15;

  // 1. Index and get all chunks
  const allChunks = await indexDocuments(rawDocs, options);
  if (allChunks.length === 0) return [];

  // If total document content is small enough to fit inside budget, return all chunks directly
  const totalLength = allChunks.reduce((acc, c) => acc + c.text.length, 0);
  if (totalLength <= maxTotalChars && allChunks.length <= topK) {
    return allChunks.map((c, idx) => ({ ...c, similarityScore: 1 - idx * 0.05 }));
  }

  // 2. Generate embedding for user query
  let queryEmbedding: number[] | null = null;
  try {
    const [qEmb] = await generateEmbeddings([cleanQuery]);
    queryEmbedding = qEmb;
  } catch {
    queryEmbedding = null;
  }

  const queryTokens = tokenize(cleanQuery);

  // 3. Score each chunk
  const scoredChunks: DocumentChunk[] = allChunks.map(chunk => {
    let semanticScore = 0;
    if (queryEmbedding && chunk.embedding) {
      semanticScore = cosineSimilarity(queryEmbedding, chunk.embedding);
    }

    const bm25Score = computeBM25Score(queryTokens, `${chunk.docTitle} ${chunk.text}`);

    // Hybrid Score: If semantic embedding exists, weight 70% vector + 30% keyword; else 100% BM25
    const finalScore = queryEmbedding && chunk.embedding
      ? semanticScore * 0.7 + bm25Score * 0.3
      : bm25Score;

    return {
      ...chunk,
      similarityScore: Math.round(finalScore * 1000) / 1000,
    };
  });

  // 4. Sort by score descending
  scoredChunks.sort((a, b) => (b.similarityScore || 0) - (a.similarityScore || 0));

  // 5. Select top-K chunks respecting char budget
  const selected: DocumentChunk[] = [];
  let accumulatedChars = 0;

  for (const chunk of scoredChunks) {
    if (selected.length >= topK) break;
    // Include if score passes threshold or if we have very few chunks
    if ((chunk.similarityScore || 0) >= minSimilarity || selected.length < 2) {
      if (accumulatedChars + chunk.text.length <= maxTotalChars) {
        selected.push(chunk);
        accumulatedChars += chunk.text.length;
      }
    }
  }

  // If no chunks passed threshold (e.g. general questions), pick top chunks
  if (selected.length === 0 && scoredChunks.length > 0) {
    for (const chunk of scoredChunks.slice(0, Math.min(topK, 3))) {
      selected.push(chunk);
    }
  }

  return selected;
}

/**
 * Formats retrieved chunks into a clean, structured context string for LLM prompts.
 */
export function formatChunksForPrompt(chunks: DocumentChunk[]): string {
  if (!chunks || chunks.length === 0) return '';

  return chunks
    .map(
      (chunk, idx) =>
        `--- ĐOẠN TRÍCH [${idx + 1}] TỪ TÀI LIỆU: "${chunk.docTitle}" (Độ liên quan: ${Math.round(
          (chunk.similarityScore || 0) * 100
        )}%) ---\n${chunk.text}`
    )
    .join('\n\n');
}

