import { generateEmbeddings, cosineSimilarity } from './rag';
import { supabaseAdmin } from './supabase';

export interface CachedQaItem {
  id: string;
  courseId?: number;
  question: string;
  normalizedQuestion: string;
  answer: string;
  embedding?: number[];
  createdAt: number;
  hitCount: number;
}

export interface CacheMatchResult {
  answer: string;
  matchedQuestion: string;
  similarity: number;
  isExact: boolean;
  hitCount: number;
}

const MAX_CACHE_ENTRIES = 500;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// In-memory LRU cache
const qaMemoryCache = new Map<string, CachedQaItem>();
let totalCacheHits = 0;
let totalCacheQueries = 0;

/**
 * Normalizes question string for fast exact-match lookup:
 * Lowercases, strips punctuation, normalizes unicode, handles Vietnamese đ/Đ, removes extra spaces.
 */
export function normalizeQuestion(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip diacritics for broad matching
    .replace(/[đĐ]/g, 'd')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Computes word-level Sorensen-Dice similarity between two normalized strings.
 * Dice coefficient: 2 * |A ∩ B| / (|A| + |B|)
 */
function computeTokenSimilarity(strA: string, strB: string): number {
  const setA = new Set(strA.split(/\s+/).filter(w => w.length > 1));
  const setB = new Set(strB.split(/\s+/).filter(w => w.length > 1));
  if (setA.size === 0 || setB.size === 0) return 0;

  let intersection = 0;
  for (const item of setA) {
    if (setB.has(item)) intersection++;
  }
  return (2 * intersection) / (setA.size + setB.size);
}

/**
 * Checks in-memory cache and Supabase for a matching answered question.
 * Returns the cached answer if exact match or cosine similarity >= threshold (default 0.90).
 */
export async function findCachedAnswer(options: {
  question: string;
  courseId?: number;
  threshold?: number;
}): Promise<CacheMatchResult | null> {
  totalCacheQueries++;
  const { question, courseId, threshold = 0.90 } = options;
  const rawClean = question.trim();
  if (!rawClean) return null;

  const normalized = normalizeQuestion(rawClean);
  const now = Date.now();

  // 1. Fast Path: Exact or normalized string match in memory cache (0ms)
  for (const item of qaMemoryCache.values()) {
    // If courseId is specified, check matching course or global course
    if (courseId !== undefined && item.courseId !== undefined && item.courseId !== courseId) {
      continue;
    }

    if (now - item.createdAt > CACHE_TTL_MS) {
      qaMemoryCache.delete(item.id);
      continue;
    }

    if (item.normalizedQuestion === normalized) {
      item.hitCount++;
      totalCacheHits++;
      console.log(`[Semantic Cache] Exact match hit for: "${rawClean.slice(0, 45)}" (0 tokens used, 0ms)`);
      return {
        answer: item.answer,
        matchedQuestion: item.question,
        similarity: 1.0,
        isExact: true,
        hitCount: item.hitCount,
      };
    }
  }

  // 2. Fast Path: High token similarity (>= threshold or >= 0.88) in memory cache
  for (const item of qaMemoryCache.values()) {
    if (courseId !== undefined && item.courseId !== undefined && item.courseId !== courseId) {
      continue;
    }
    const tokenSim = computeTokenSimilarity(item.normalizedQuestion, normalized);
    if (tokenSim >= Math.min(threshold, 0.88)) {
      item.hitCount++;
      totalCacheHits++;
      console.log(`[Semantic Cache] High token similarity (${(tokenSim * 100).toFixed(1)}%) hit for: "${rawClean.slice(0, 45)}"`);
      return {
        answer: item.answer,
        matchedQuestion: item.question,
        similarity: tokenSim,
        isExact: false,
        hitCount: item.hitCount,
      };
    }
  }

  // 3. Semantic Path: Vector Cosine Similarity
  // If memory cache has items with embeddings in this course, compute query embedding
  const candidatesWithEmbedding = Array.from(qaMemoryCache.values()).filter(
    item =>
      item.embedding &&
      item.embedding.length > 0 &&
      (courseId === undefined || item.courseId === undefined || item.courseId === courseId)
  );

  if (candidatesWithEmbedding.length > 0) {
    try {
      const [queryEmbed] = await generateEmbeddings([rawClean]);
      if (queryEmbed && queryEmbed.length > 0) {
        let bestMatch: CachedQaItem | null = null;
        let maxSim = 0;

        for (const candidate of candidatesWithEmbedding) {
          if (!candidate.embedding) continue;
          const sim = cosineSimilarity(queryEmbed, candidate.embedding);
          if (sim > maxSim) {
            maxSim = sim;
            bestMatch = candidate;
          }
        }

        if (bestMatch && maxSim >= threshold) {
          bestMatch.hitCount++;
          totalCacheHits++;
          console.log(
            `[Semantic Cache] Semantic match hit (${(maxSim * 100).toFixed(1)}% >= ${(threshold * 100).toFixed(0)}%) for: "${rawClean.slice(0, 45)}" -> "${bestMatch.question.slice(0, 45)}"`
          );
          return {
            answer: bestMatch.answer,
            matchedQuestion: bestMatch.question,
            similarity: maxSim,
            isExact: false,
            hitCount: bestMatch.hitCount,
          };
        }
      }
    } catch (err) {
      console.warn('[Semantic Cache] Embedding comparison error:', err);
    }
  }

  // 4. Supabase DB Fallback (if table exists)
  if (supabaseAdmin) {
    try {
      let query = supabaseAdmin
        .from('ai_qa_cache')
        .select('*')
        .eq('normalized_question', normalized)
        .limit(1);

      if (courseId) {
        query = query.eq('course_id', courseId);
      }

      const { data, error } = await query;
      if (!error && data && data.length > 0) {
        const row = data[0];
        totalCacheHits++;
        console.log(`[Semantic Cache] Supabase DB hit for: "${rawClean.slice(0, 45)}"`);

        // Cache in memory for next time
        saveToMemoryCache({
          question: row.question || rawClean,
          normalizedQuestion: normalized,
          answer: row.answer,
          courseId: row.course_id,
        });

        return {
          answer: row.answer,
          matchedQuestion: row.question,
          similarity: 1.0,
          isExact: true,
          hitCount: (row.hit_count || 1) + 1,
        };
      }
    } catch {
      // Ignore DB table missing errors
    }
  }

  return null;
}

function saveToMemoryCache(params: {
  question: string;
  normalizedQuestion?: string;
  answer: string;
  courseId?: number;
  embedding?: number[];
}): CachedQaItem {
  // Evict oldest if full
  if (qaMemoryCache.size >= MAX_CACHE_ENTRIES) {
    const firstKey = qaMemoryCache.keys().next().value;
    if (firstKey) qaMemoryCache.delete(firstKey);
  }

  const id = `qa_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const item: CachedQaItem = {
    id,
    courseId: params.courseId,
    question: params.question,
    normalizedQuestion: params.normalizedQuestion || normalizeQuestion(params.question),
    answer: params.answer,
    embedding: params.embedding,
    createdAt: Date.now(),
    hitCount: 0,
  };

  qaMemoryCache.set(id, item);
  return item;
}

/**
 * Stores a question-answer pair into memory cache and attempts Supabase persistence.
 */
export async function storeCachedAnswer(params: {
  question: string;
  answer: string;
  courseId?: number;
  embedding?: number[];
}): Promise<void> {
  const { question, answer, courseId, embedding } = params;
  if (!question.trim() || !answer.trim()) return;

  const normalizedQuestion = normalizeQuestion(question);

  // Check if answer indicates an error or fallback to avoid caching bad answers
  if (
    answer.includes('⚠️ **Không thể kết nối API AI**') ||
    answer.includes('Quota exceeded') ||
    answer.includes('Rate limit')
  ) {
    return;
  }

  // 1. Save to in-memory cache
  saveToMemoryCache({
    question,
    normalizedQuestion,
    answer,
    courseId,
    embedding,
  });

  // 2. If no embedding provided and keys are active, asynchronously generate embedding
  if (!embedding) {
    setTimeout(async () => {
      try {
        const [generatedEmbed] = await generateEmbeddings([question]);
        if (generatedEmbed) {
          for (const item of qaMemoryCache.values()) {
            if (item.normalizedQuestion === normalizedQuestion) {
              item.embedding = generatedEmbed;
              break;
            }
          }
        }
      } catch {
        // Ignore background embedding error
      }
    }, 100);
  }

  // 3. Persist to Supabase if configured (fire & forget)
  if (supabaseAdmin) {
    try {
      await supabaseAdmin.from('ai_qa_cache').upsert(
        {
          course_id: courseId ?? null,
          question,
          normalized_question: normalizedQuestion,
          answer,
          created_at: new Date().toISOString(),
        },
        { onConflict: 'course_id,normalized_question' }
      );
    } catch {
      // Table may not exist yet, memory cache is already active
    }
  }
}

/**
 * Returns statistics about the semantic cache.
 */
export function getSemanticCacheStats() {
  return {
    totalEntries: qaMemoryCache.size,
    totalQueries: totalCacheQueries,
    totalHits: totalCacheHits,
    hitRate: totalCacheQueries > 0 ? (totalCacheHits / totalCacheQueries) * 100 : 0,
  };
}
