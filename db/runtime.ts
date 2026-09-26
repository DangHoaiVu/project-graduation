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

export function runtimeEnv(): AppRuntime {
  const getVar = (key: string, fallback = '') => {
    return (process.env[key] as string) || fallback;
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
    COHERE_API_KEY: getVar('COHERE_API_KEY'),
    AI_HORDE_API_KEY: getVar('AI_HORDE_API_KEY', '0000000000'),
    GEMINI_API_KEY: getVar('GEMINI_API_KEY'),
    GEMINI_API_KEYS: getVar('GEMINI_API_KEYS'),
    GOOGLE_API_KEY: getVar('GOOGLE_API_KEY'),
    OPENAI_API_KEY: getVar('OPENAI_API_KEY'),
    ANTHROPIC_API_KEY: getVar('ANTHROPIC_API_KEY'),
    MOODLE_URL: getVar('MOODLE_URL', 'https://moodletvk.duckdns.org'),
    MOODLE_TOKEN: getVar('MOODLE_TOKEN'),
    MOODLE_TOKEN_ENCRYPTION_KEY: getVar('MOODLE_TOKEN_ENCRYPTION_KEY'),
    CRON_SECRET: getVar('CRON_SECRET'),
    MOODLE_DB_HOST: getVar('MOODLE_DB_HOST', '127.0.0.1'),
    MOODLE_DB_PORT: getVar('MOODLE_DB_PORT', '3306'),
    MOODLE_DB_USER: getVar('MOODLE_DB_USER', 'root'),
    MOODLE_DB_PASSWORD: getVar('MOODLE_DB_PASSWORD', ''),
    MOODLE_DB_NAME: getVar('MOODLE_DB_NAME', 'moodle'),
  };
}

export async function currentUserId() {
  try {
    const { headers } = await import('next/headers');
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
