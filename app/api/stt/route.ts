import { NextRequest, NextResponse } from 'next/server';

// Correct common STT mishears that slip through keyword boosting.
// "Ken" → "can": Deepgram occasionally maps the vowel in "can" to the name.
const fixMishears = (t: string) => t.replace(/\bKen\b/g, 'can').replace(/\bken\b/g, 'can');

export async function POST(req: NextRequest) {
  let audio: File | null = null;
  try {
    const form = await req.formData();
    audio = form.get('audio') as File | null;
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  if (!audio || audio.size < 100) {
    return NextResponse.json({ transcript: '' });
  }

  // Deepgram Nova-3: ~200ms latency, native keyword boosting for "Based"
  // Falls back to Groq Whisper if DEEPGRAM_API_KEY is absent.
  const deepgramKey = process.env.DEEPGRAM_API_KEY;
  if (deepgramKey) {
    try {
      const params = new URLSearchParams({
        model: 'nova-3',
        language: 'en',
        punctuate: 'true',
        // Boost "Based" strongly so it wins over phonetic near-misses like "raise", "bis"
        keywords: 'Based:5',
      });
      const res = await fetch(`https://api.deepgram.com/v1/listen?${params}`, {
        method: 'POST',
        headers: {
          Authorization: `Token ${deepgramKey}`,
          'Content-Type': 'audio/wav',
        },
        body: await audio.arrayBuffer(),
      });
      if (res.ok) {
        const data = (await res.json()) as {
          results?: {
            channels?: {
              alternatives?: { transcript?: string; confidence?: number }[];
            }[];
          };
        };
        const alt = data.results?.channels?.[0]?.alternatives?.[0];
        const transcript = fixMishears(alt?.transcript ?? '');
        // Deepgram confidence < 0.72 on a non-empty transcript almost always means
        // ambient audio was misread — discard rather than fire a false wake/command.
        if (transcript && (alt?.confidence ?? 1) < 0.72) {
          return NextResponse.json({ transcript: '' });
        }
        return NextResponse.json({ transcript });
      }
    } catch {
      // Fall through to Groq
    }
  }

  // Groq Whisper fallback
  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) {
    return NextResponse.json({ error: 'STT not configured' }, { status: 503 });
  }

  const groqForm = new FormData();
  groqForm.append('file', audio, 'audio.wav');
  groqForm.append('model', 'whisper-large-v3');
  groqForm.append('response_format', 'verbose_json');
  groqForm.append('language', 'en');
  groqForm.append('temperature', '0');
  groqForm.append('prompt', 'Hey Based. Hi Based. Okay Based. Hello Based. Based.');

  try {
    const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${groqKey}` },
      body: groqForm,
    });
    if (!res.ok) return NextResponse.json({ transcript: '' });
    const data = (await res.json()) as {
      text?: string;
      segments?: { no_speech_prob?: number }[];
    };
    // Whisper's no_speech_prob > 0.4 means the model thinks this is noise, not speech.
    const noSpeechProb = data.segments?.[0]?.no_speech_prob ?? 0;
    if (noSpeechProb > 0.4) return NextResponse.json({ transcript: '' });
    return NextResponse.json({ transcript: fixMishears(data.text ?? '') });
  } catch {
    return NextResponse.json({ transcript: '' });
  }
}
