import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  const { code } = await req.json();
  const correctCode = process.env.BETA_ACCESS_CODE;

  if (!correctCode || code !== correctCode) {
    return NextResponse.json({ error: 'Invalid access code' }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set('based_beta_access', correctCode, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 30, // 30 days
    path: '/',
  });
  return res;
}
