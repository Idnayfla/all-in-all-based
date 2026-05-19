import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const audio = formData.get('audio') as Blob | null;
    if (!audio) return NextResponse.json({ error: 'No audio' }, { status: 400 });

    const groqForm = new FormData();
    groqForm.append('file', audio, 'recording.webm');
    groqForm.append('model', 'whisper-large-v3-turbo');
    groqForm.append('response_format', 'json');

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
    return NextResponse.json({ text: data.text ?? '' });
  } catch (err: any) {
    console.error('[transcribe]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
