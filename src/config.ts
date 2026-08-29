const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim() ?? "";
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() ?? "";
const learningApiUrl = import.meta.env.VITE_LEARNING_API_URL?.trim() ?? "";

export const appConfig = {
  supabaseUrl,
  supabaseAnonKey,
  hasSupabase: /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(supabaseUrl) && supabaseAnonKey.length > 20,
  learningApiUrl,
  hasLearningApi: /^https:\/\//i.test(learningApiUrl),
} as const;
