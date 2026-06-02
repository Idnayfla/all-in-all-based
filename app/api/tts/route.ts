import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';

export const maxDuration = 60;

const MAX_CACHEABLE_LEN = 200;
const TTL_SECONDS = 3 * 24 * 60 * 60; // 3 days

function ttsCacheKey(text: string, gender: string) {
  const hash = crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);
  return `tts:${gender}:${hash}`;
}

async function cacheGet(
  key: string
): Promise<{ audioBase64: string; words: WordTimestamp[]; mime: string } | null> {
  if (!process.env.REDIS_URL) return null;
  try {
    const { createClient } = await import('redis');
    const client = createClient({ url: process.env.REDIS_URL });
    await client.connect();
    const raw = await client.get(key);
    await client.disconnect();
    if (!raw) return null;
    return JSON.parse(raw) as { audioBase64: string; words: WordTimestamp[]; mime: string };
  } catch {
    return null;
  }
}

async function cacheSet(
  key: string,
  value: { audioBase64: string; words: WordTimestamp[]; mime: string }
): Promise<void> {
  if (!process.env.REDIS_URL) return;
  try {
    const { createClient } = await import('redis');
    const client = createClient({ url: process.env.REDIS_URL });
    await client.connect();
    await client.set(key, JSON.stringify(value), { EX: TTL_SECONDS });
    await client.disconnect();
  } catch {
    // Non-fatal — cache miss is acceptable
  }
}

interface WordTimestamp {
  word: string;
  startTime: number;
}

const VOICES: Record<string, string> = {
  male: '2gpuOKD5shp7mKh4qkta', // Based — warm, unhurried, intimately direct (saved permanent voice 2026-05-30)
  female: 'HuUeqrT8e2PWVP3RIv1T', // Based-D-Female-2 — warm, grounded female (ElevenLabs Voice Design, mid-20s neutral American female)
};

async function tryModal(
  text: string
): Promise<{ audioBase64: string; words: WordTimestamp[]; mime: string } | null> {
  const endpoint = process.env.MODAL_TTS_ENDPOINT;
  if (!endpoint) return null;
  try {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 20000); // 20s hard timeout — leaves ~40s for ElevenLabs fallback within the 60s maxDuration
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: abort.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = (await res.json()) as { audioBase64?: string; error?: string };
    if (!data.audioBase64) return null;
    return { audioBase64: data.audioBase64, words: [], mime: 'audio/wav' };
  } catch {
    return null;
  }
}

async function tryElevenLabs(
  text: string,
  gender: 'male' | 'female'
): Promise<{ audioBase64: string; words: WordTimestamp[]; mime: string } | null> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return null;
  const voiceId = VOICES[gender] ?? VOICES.male;
  try {
    const res = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/with-timestamps`,
      {
        method: 'POST',
        headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
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
    if (!res.ok) return null;
    const data = (await res.json()) as {
      audio_base64: string;
      alignment: { characters: string[]; character_start_times_seconds: number[] };
    };
    const words: WordTimestamp[] = [];
    const inputWords = text.split(/\s+/);
    const chars = data.alignment.characters;
    const startTimes = data.alignment.character_start_times_seconds;
    let charIdx = 0;
    for (const word of inputWords) {
      while (charIdx < chars.length && chars[charIdx] === ' ') charIdx++;
      words.push({ word, startTime: startTimes[charIdx] ?? 0 });
      charIdx += word.length + 1;
    }
    return { audioBase64: data.audio_base64, words, mime: 'audio/mpeg' };
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const { text, gender = 'male' } = (await req.json().catch(() => ({}))) as {
    text?: string;
    gender?: 'male' | 'female';
  };
  if (!text?.trim() || text.length > 1000) {
    return NextResponse.json({ error: 'Invalid text' }, { status: 400 });
  }

  const trimmedText = text.trim();
  const cacheable = trimmedText.length <= MAX_CACHEABLE_LEN;
  const key = cacheable ? ttsCacheKey(trimmedText, gender) : '';

  if (cacheable) {
    const hit = await cacheGet(key);
    if (hit) {
      return NextResponse.json(hit, {
        headers: { 'Cache-Control': 'no-store', 'X-TTS-Cache': 'HIT' },
      });
    }
  }

  // Try Modal (self-hosted F5-TTS) first, fall back to ElevenLabs
  const result = (await tryModal(trimmedText)) ?? (await tryElevenLabs(trimmedText, gender));

  if (!result) {
    return NextResponse.json({ error: 'TTS not configured' }, { status: 503 });
  }

  if (cacheable) void cacheSet(key, result);

  return NextResponse.json(
    { audioBase64: result.audioBase64, words: result.words, mime: result.mime },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
