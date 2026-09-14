import type { QuizAnalysisData } from '@/app/types';
import { cleanAnswerText } from '@/lib/moodle-quiz-parser';

const PREFIX = 'lms_quiz_analysis_';
const INDEX_KEY = 'lms_quiz_analysis_index';

function sanitizeAnalysis(data: QuizAnalysisData): QuizAnalysisData {
  if (!data) return data;
  if (!Array.isArray(data.questionsAnalysis)) return data;
  return {
    ...data,
    questionsAnalysis: data.questionsAnalysis.map(q => ({
      ...q,
      studentAnswer: cleanAnswerText(q.studentAnswer),
      rightAnswer: cleanAnswerText(q.rightAnswer),
    })),
  };
}

/**
 * Retrieve a saved quiz diagnosis from browser localStorage by attemptId
 */
export function getStoredAnalysis(attemptId: number | string): QuizAnalysisData | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(`${PREFIX}${attemptId}`);
    if (!raw) return null;
    const data = JSON.parse(raw) as QuizAnalysisData;
    return sanitizeAnalysis({ ...data, cached: true });
  } catch (e) {
    console.warn('Failed to read quiz analysis from localStorage:', e);
    return null;
  }
}

/**
 * Save a quiz diagnosis into browser localStorage
 */
export function saveStoredAnalysis(attemptId: number | string, data: QuizAnalysisData): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(`${PREFIX}${attemptId}`, JSON.stringify(sanitizeAnalysis({ ...data, cached: true })));
    
    // Update attemptId index list
    const index = getAllStoredAttemptIds();
    const numId = Number(attemptId);
    if (!index.includes(numId)) {
      index.push(numId);
      localStorage.setItem(INDEX_KEY, JSON.stringify(index));
    }
  } catch (e) {
    console.warn('Failed to save quiz analysis to localStorage:', e);
  }
}

export function removeStoredAnalysis(attemptId: number | string): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(`${PREFIX}${attemptId}`);
    const next = getAllStoredAttemptIds().filter(id => Number(id) !== Number(attemptId));
    localStorage.setItem(INDEX_KEY, JSON.stringify(next));
  } catch (e) {
    console.warn('Failed to remove quiz analysis from localStorage:', e);
  }
}

/**
 * Get all attempt IDs that have been cached in browser localStorage
 */
export function getAllStoredAttemptIds(): number[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as number[];
  } catch {
    return [];
  }
}

/**
 * Get the most recent diagnosis stored in localStorage for a specific course
 */
export function getLatestStoredAnalysisForCourse(courseId?: number | string): QuizAnalysisData | null {
  if (typeof window === 'undefined') return null;
  try {
    const ids = getAllStoredAttemptIds();
    for (let i = ids.length - 1; i >= 0; i--) {
      const stored = getStoredAnalysis(ids[i]);
      if (stored) {
        if (!courseId || String(stored.courseId) === String(courseId)) {
          return stored;
        }
      }
    }
  } catch (e) {
    console.warn('Error reading latest stored analysis:', e);
  }
  return null;
}

