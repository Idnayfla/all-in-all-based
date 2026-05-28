import { NextRequest, NextResponse } from 'next/server';
import { getUserId } from '../_auth';

export async function POST(req: NextRequest) {
  try {
    await getUserId(req);
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const formData = await req.formData();
    const audio = formData.get('audio') as File | Blob | null;
    if (!audio) return NextResponse.json({ error: 'No audio' }, { status: 400 });
    const filename = (audio as File).name ?? 'recording.webm';

    const locale = (formData.get('locale') as string | null) ?? 'en';
    // Map app locale codes to Whisper ISO 639-1 codes
    const LOCALE_TO_WHISPER: Record<string, string> = {
      en: 'en',
      ms: 'ms',
      'zh-Hans': 'zh',
      ta: 'ta',
      ja: 'ja',
      'pt-BR': 'pt',
    };
    const language = LOCALE_TO_WHISPER[locale] ?? 'en';

    const groqForm = new FormData();
    groqForm.append('file', audio, filename);
    groqForm.append('model', 'whisper-large-v3-turbo');
    groqForm.append('response_format', 'json');
    groqForm.append('language', language);

    const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
      body: groqForm,
    });

    if (!res.ok) {
      const err = await res.text();
      console.error('[transcribe] Groq error:', res.status, err);
      return NextResponse.json({ error: `Transcription failed: ${res.status}` }, { status: 500 });
    }

    const data = await res.json();
    const raw: string = data.text ?? '';
    const normalized = raw
      .trim()
      .toLowerCase()
      .replace(/[.,!?\s]+$/, '');
    const HALLUCINATIONS = [
      'thank you',
      'thanks for watching',
      'thank you for watching',
      'thanks for listening',
      'bye',
      'you',
    ];
    const clean = HALLUCINATIONS.includes(normalized) ? '' : raw;
    return NextResponse.json({ text: clean });
  } catch (err: unknown) {
    console.error('[transcribe]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
