import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '../../_auth';
import { exchangeCode, saveTokensForUser, getUserEmail } from '@/lib/googleCalendar';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://getbased.dev';

// Google redirects here after OAuth consent.
// ?code=... &state=<supabase_jwt> is passed through from buildAuthUrl.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state'); // the user's Supabase JWT
  const oauthError = searchParams.get('error');

  if (oauthError || !code || !state) {
    return NextResponse.redirect(`${APP_URL}/?calendar=error`);
  }

  try {
    const {
      data: { user },
      error: authError,
    } = await supabaseAdmin.auth.getUser(state);
    if (authError || !user) {
      return NextResponse.redirect(`${APP_URL}/?calendar=error`);
    }

    const tokens = await exchangeCode(code);
    const email = await getUserEmail(tokens.access_token);

    await saveTokensForUser(user.id, {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expiry: Date.now() + tokens.expires_in * 1000,
      email,
    });

    return NextResponse.redirect(`${APP_URL}/?calendar=connected`);
  } catch {
    return NextResponse.redirect(`${APP_URL}/?calendar=error`);
  }
}
