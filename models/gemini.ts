import { GoogleGenAI } from '@google/genai';
import { runtimeEnv } from '@/db/runtime';

let geminiClient: GoogleGenAI | null = null;
let lastGeminiKey = '';

export function getGeminiClient() {
  const env = runtimeEnv();
  const currentKey = env.GEMINI_API_KEY || env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
  if (!currentKey || currentKey.startsWith('AIzaSy...') || currentKey === 'AIzaSy...') {
    return null;
  }
  if (!geminiClient || lastGeminiKey !== currentKey) {
    lastGeminiKey = currentKey;
    geminiClient = new GoogleGenAI({
      apiKey: currentKey,
    });
  }
  return geminiClient;
}

export const GEMINI_MODEL = 'gemini-2.5-flash';
export const GEMINI_BACKUP_MODELS = ['gemini-2.5-pro'];
