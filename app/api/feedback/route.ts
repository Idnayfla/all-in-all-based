import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/app/api/_auth';

export async function POST(req: NextRequest) {
  try {
    const { message, email, type, context } = await req.json();
    if (!message?.trim()) {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 });
    }

    const { error } = await supabaseAdmin.from('feedback').insert({
      message: message.trim(),
      email:   email?.trim() || null,
      type:    type || 'general',
      context: context?.trim() || null,
    });

    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error('[feedback]', e);
    return NextResponse.json({ error: 'Could not save feedback' }, { status: 500 });
  }
}
