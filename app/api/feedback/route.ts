import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/app/api/_auth';

// ── No auth guard, no Redis ──────────────────────────────────────────────────
// Feedback is frequently submitted from error/degraded states (e.g. the
// "Report" button shown when generation fails), where the session token may
// be stale or unavailable. Requiring auth here caused reports to silently 401.
//
// Redis rate-limiting was removed: it could hang the request when Redis was
// slow or unreachable (commands after connect had no timeout), leaving the UI
// stuck on "Sending…" forever. This endpoint is obscure and the table holds no
// sensitive data — reliability matters far more than marginal spam protection.
export async function POST(req: NextRequest) {
  try {
    const { message, email, type, context } = await req.json();
    if (!message?.trim()) {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 });
    }

    const { error } = await supabaseAdmin.from('feedback').insert({
      message: message.trim().slice(0, 2000),
      email: email?.trim() || null,
      type: type || 'general',
      context: context?.trim().slice(0, 500) || null,
    });

    if (error) {
      console.error('[feedback] Supabase error:', error);
      return NextResponse.json({ error: 'Could not save feedback' }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    console.error('[feedback]', e);
    return NextResponse.json({ error: 'Could not save feedback' }, { status: 500 });
  }
}
