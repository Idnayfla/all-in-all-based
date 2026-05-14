export function mapClaudeToGeminiModel(claudeModel: string): string {
  // Extract model family (opus, sonnet, haiku)
  const match = claudeModel.match(/(opus|sonnet|haiku)/i);
  if (!match) return 'gemini-2.0-flash'; // Default fallback

  const family = match[1].toLowerCase();
  switch (family) {
    case 'opus':
      return 'gemini-2.0-flash'; // Gemini's most capable model
    case 'sonnet':
      return 'gemini-1.5-flash';
    case 'haiku':
      return 'gemini-1.5-flash'; // Use flash for speed on smaller tasks
    default:
      return 'gemini-2.0-flash';
  }
}

export function getClaudeModel(
  type: 'planner' | 'generator' | 'summary'
): string {
  // Match existing generate route logic
  switch (type) {
    case 'planner':
      return 'claude-haiku-4-5-20251001';
    case 'generator':
      return 'claude-opus-4-7-20250219';
    case 'summary':
      return 'claude-haiku-4-5-20251001';
  }
}

export function getGeminiModel(
  type: 'planner' | 'generator' | 'summary'
): string {
  const claudeModel = getClaudeModel(type);
  return mapClaudeToGeminiModel(claudeModel);
}
