import { GoogleGenerativeAI } from '@google/generative-ai';
import { getGeminiModel } from './models';

let geminiClient: GoogleGenerativeAI | null = null;

function initializeGeminiClient(): GoogleGenerativeAI {
  if (geminiClient) return geminiClient;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY environment variable is not set. Gemini fallback unavailable.'
    );
  }

  geminiClient = new GoogleGenerativeAI(apiKey);
  return geminiClient;
}

export async function generateWithGemini(
  prompt: string,
  systemPrompt: string,
  modelType: 'planner' | 'generator' | 'summary'
): Promise<string> {
  const client = initializeGeminiClient();
  const model = getGeminiModel(modelType);

  const geminiModel = client.getGenerativeModel({ model });

  const response = await geminiModel.generateContent({
    contents: [
      {
        role: 'user',
        parts: [{ text: systemPrompt + '\n\n' + prompt }],
      },
    ],
  });

  const textContent = response.response.candidates?.[0]?.content?.parts?.[0];
  if (textContent && 'text' in textContent) {
    return textContent.text ?? '';
  }

  throw new Error('No text content in Gemini response');
}

export function canUseGemini(): boolean {
  return !!process.env.GEMINI_API_KEY;
}
