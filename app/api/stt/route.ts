import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) {
    return NextResponse.json({ error: 'STT not configured' }, { status: 503 });
  }

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

  const groqForm = new FormData();
  groqForm.append('file', audio, 'audio.webm');
  groqForm.append('model', 'whisper-large-v3-turbo');
  groqForm.append('response_format', 'json');
  groqForm.append('language', 'en');

  try {
    const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${groqKey}` },
      body: groqForm,
    });

    if (!res.ok) {
      return NextResponse.json({ transcript: '' });
    }

    const data = (await res.json()) as { text?: string };
    return NextResponse.json({ transcript: data.text ?? '' });
  } catch {
    return NextResponse.json({ transcript: '' });
  }
}
