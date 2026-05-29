import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 30;

interface WordTimestamp {
  word: string;
  startTime: number;
}

const VOICES: Record<string, string> = {
  male: 'witRXbSJAs6nWlhTTzNe', // Based-D — warm, composed male (ElevenLabs Voice Design, late-20s neutral American male)
  female: 'HuUeqrT8e2PWVP3RIv1T', // Based-D-Female-2 — warm, grounded female (ElevenLabs Voice Design, mid-20s neutral American female)
};

export async function POST(req: NextRequest) {
  const { text, gender = 'male' } = (await req.json().catch(() => ({}))) as {
    text?: string;
    gender?: 'male' | 'female';
  };
  if (!text?.trim() || text.length > 1000) {
    return NextResponse.json({ error: 'Invalid text' }, { status: 400 });
  }

  const voiceId = VOICES[gender] ?? VOICES.male;
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'TTS not configured' }, { status: 503 });

  const trimmedText = text.trim();

  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/with-timestamps`,
    {
      method: 'POST',
      headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: trimmedText,
        model_id: 'eleven_flash_v2_5',
        voice_settings: {
          stability: 0.55,
          similarity_boost: 0.8,
          style: 0.35,
          use_speaker_boost: true,
        },
      }),
    }
  );

  if (!res.ok) {
    const err = await res.text();
    console.error('[tts]', res.status, err);
    return NextResponse.json({ error: 'TTS failed' }, { status: 500 });
  }

  const data = (await res.json()) as {
    audio_base64: string;
    alignment: {
      characters: string[];
      character_start_times_seconds: number[];
      character_end_times_seconds: number[];
    };
  };

  const audioBase64: string = data.audio_base64;
  const alignment = data.alignment;

  // Build word timestamps from character alignment
  const words: WordTimestamp[] = [];
  const inputWords = trimmedText.trim().split(/\s+/);
  const chars: string[] = alignment.characters;
  const startTimes: number[] = alignment.character_start_times_seconds;

  let charIdx = 0;
  for (const word of inputWords) {
    // Find the first non-space character index for this word
    while (charIdx < chars.length && chars[charIdx] === ' ') charIdx++;
    const startTime = startTimes[charIdx] ?? 0;
    words.push({ word, startTime });
    charIdx += word.length + 1; // +1 for the space after the word
  }

  return NextResponse.json({ audioBase64, words }, { headers: { 'Cache-Control': 'no-store' } });
}
