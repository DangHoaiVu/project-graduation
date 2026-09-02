declare namespace NodeJS {
  interface ProcessEnv {
    DATABASE_URL?: string;
    NEXT_PUBLIC_SUPABASE_URL?: string;
    NEXT_PUBLIC_SUPABASE_ANON_KEY?: string;
    SUPABASE_SERVICE_ROLE_KEY?: string;
    CLOUDINARY_CLOUD_NAME?: string;
    CLOUDINARY_API_KEY?: string;
    CLOUDINARY_API_SECRET?: string;
    CLOUDINARY_URL?: string;
    GROQ_API_KEY?: string;
    GEMINI_API_KEY?: string;
    GOOGLE_API_KEY?: string;
    OPENAI_API_KEY?: string;
    ANTHROPIC_API_KEY?: string;
    MOODLE_URL?: string;
    MOODLE_TOKEN?: string;
  }
}
