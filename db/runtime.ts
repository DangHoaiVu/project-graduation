import { headers } from 'next/headers';
import fs from 'node:fs';
import path from 'node:path';

export type AppRuntime = {
  DATABASE_URL?: string;
  NEXT_PUBLIC_SUPABASE_URL?: string;
  NEXT_PUBLIC_SUPABASE_ANON_KEY?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  CLOUDINARY_CLOUD_NAME?: string;
  CLOUDINARY_API_KEY?: string;
  CLOUDINARY_API_SECRET?: string;
  CLOUDINARY_URL?: string;
  GROQ_API_KEY?: string;
  COHERE_API_KEY?: string;
  AI_HORDE_API_KEY?: string;
  GEMINI_API_KEY?: string;
  GEMINI_API_KEYS?: string;
  GOOGLE_API_KEY?: string;
  OPENAI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  MOODLE_URL?: string;
  MOODLE_TOKEN?: string;
  MOODLE_TOKEN_ENCRYPTION_KEY?: string;
  CRON_SECRET?: string;
  MOODLE_DB_HOST?: string;
  MOODLE_DB_PORT?: string;
  MOODLE_DB_USER?: string;
  MOODLE_DB_PASSWORD?: string;
  MOODLE_DB_NAME?: string;
};

function readLocalEnvFiles(): Record<string, string> {
  const result: Record<string, string> = {};
  const candidates = ['.dev.vars', '.env.local', '.env'];

  for (const file of candidates) {
    try {
      const filePath = path.resolve(process.cwd(), file);
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf8');
        const lines = content.split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) continue;
          const eqIdx = trimmed.indexOf('=');
          if (eqIdx > 0) {
            const key = trimmed.slice(0, eqIdx).trim();
            let val = trimmed.slice(eqIdx + 1).trim();
            if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
              val = val.slice(1, -1);
            }
            if (key && val && !result[key]) {
              result[key] = val;
            }
          }
        }
      }
    } catch {
      // Ignore file read issues
    }
  }
  return result;
}

let cachedLocalEnv: Record<string, string> | null = null;

export function runtimeEnv(): AppRuntime {
  let cfEnv: Record<string, unknown> = {};
  try {
    // In Cloudflare Workers environment, env can be read from cloudflare:workers
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { env } = require('cloudflare:workers');
    cfEnv = (env as Record<string, unknown>) || {};
  } catch {
    // Standard Node / Next.js environment
  }

  if (!cachedLocalEnv || process.env.NODE_ENV !== 'production') {
    cachedLocalEnv = readLocalEnvFiles();
  }

  const getVar = (key: string) => {
    return (
      (process.env[key] as string) ||
      (cfEnv[key] as string) ||
      cachedLocalEnv?.[key] ||
      ''
    );
  };

  return {
    DATABASE_URL: getVar('DATABASE_URL'),
    NEXT_PUBLIC_SUPABASE_URL: getVar('NEXT_PUBLIC_SUPABASE_URL'),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: getVar('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    SUPABASE_SERVICE_ROLE_KEY: getVar('SUPABASE_SERVICE_ROLE_KEY'),
    CLOUDINARY_CLOUD_NAME: getVar('CLOUDINARY_CLOUD_NAME'),
    CLOUDINARY_API_KEY: getVar('CLOUDINARY_API_KEY'),
    CLOUDINARY_API_SECRET: getVar('CLOUDINARY_API_SECRET'),
    CLOUDINARY_URL: getVar('CLOUDINARY_URL'),
    GROQ_API_KEY: getVar('GROQ_API_KEY'),
    GEMINI_API_KEY: getVar('GEMINI_API_KEY'),
    GEMINI_API_KEYS: getVar('GEMINI_API_KEYS'),
    GOOGLE_API_KEY: getVar('GOOGLE_API_KEY'),
    OPENAI_API_KEY: getVar('OPENAI_API_KEY'),
    ANTHROPIC_API_KEY: getVar('ANTHROPIC_API_KEY'),
    MOODLE_URL: getVar('MOODLE_URL'),
    MOODLE_TOKEN: getVar('MOODLE_TOKEN'),
    MOODLE_TOKEN_ENCRYPTION_KEY: getVar('MOODLE_TOKEN_ENCRYPTION_KEY'),
    CRON_SECRET: getVar('CRON_SECRET'),
    MOODLE_DB_HOST: getVar('MOODLE_DB_HOST') || '127.0.0.1',
    MOODLE_DB_PORT: getVar('MOODLE_DB_PORT') || '3306',
    MOODLE_DB_USER: getVar('MOODLE_DB_USER') || 'root',
    MOODLE_DB_PASSWORD: getVar('MOODLE_DB_PASSWORD') || '',
    MOODLE_DB_NAME: getVar('MOODLE_DB_NAME') || 'moodle',
  };
}

export async function currentUserId() {
  try {
    const requestHeaders = await headers();
    return (
      requestHeaders.get('oai-authenticated-user-id') ??
      requestHeaders.get('x-user-id') ??
      (process.env.NODE_ENV === 'development' ? 'preview-user' : null)
    );
  } catch {
    return process.env.NODE_ENV === 'development' ? 'preview-user' : null;
  }
}
