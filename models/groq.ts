import Groq from 'groq-sdk';
import { runtimeEnv } from '@/db/runtime';

let groqClient: Groq | null = null;

export function getGroqClient() {
  const currentKey = runtimeEnv().GROQ_API_KEY || process.env.GROQ_API_KEY || '';
  if (!currentKey || currentKey.startsWith('gsk_your') || currentKey === 'gsk_...') {
    return null;
  }
  if (!groqClient || groqClient.apiKey !== currentKey) {
    groqClient = new Groq({
      apiKey: currentKey,
    });
  }
  return groqClient;
}

// Verified active models on your Groq key
export const GROQ_MODEL = 'openai/gpt-oss-120b';
export const GROQ_BACKUP_MODELS = ['qwen/qwen3.8-27b'];
