// Model IDs — override via Vercel env vars to upgrade without a code deploy.
// Dashboard: Settings → Environment Variables → add MODEL_OPUS / MODEL_SONNET / MODEL_HAIKU
export const MODEL_OPUS = process.env.MODEL_OPUS ?? 'claude-opus-4-8';
export const MODEL_SONNET = process.env.MODEL_SONNET ?? 'claude-sonnet-4-6';
export const MODEL_HAIKU = process.env.MODEL_HAIKU ?? 'claude-haiku-4-5';
export const MODEL_GROQ = process.env.MODEL_GROQ ?? 'llama-3.3-70b-versatile';
export const MODEL_CEREBRAS = process.env.MODEL_CEREBRAS ?? 'gpt-oss-120b';
export const MODEL_GEMINI_VISION = process.env.MODEL_GEMINI_VISION ?? 'gemini-2.5-flash';
