import { NextRequest, NextResponse } from 'next/server';

export function proxy(req: NextRequest) {
  const betaCode = process.env.BETA_ACCESS_CODE;
  if (!betaCode) return NextResponse.next(); // no code set → gate inactive (production)

  const { pathname } = req.nextUrl;

  // Always allow the gate page and its API through.
  // Also allow /auth/* so that OAuth callbacks (Google, GitHub) land correctly — the
  // user hasn't set the beta cookie yet at that point but needs the callback to complete
  // before being gated. The auth/callback page exchanges the code and then redirects to /,
  // which will properly trigger the gate with the now-established Supabase session.
  if (
    pathname.startsWith('/beta-gate') ||
    pathname.startsWith('/api/beta-gate') ||
    pathname.startsWith('/auth/') ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon')
  ) {
    return NextResponse.next();
  }

  const cookie = req.cookies.get('based_beta_access');
  if (cookie?.value === betaCode) return NextResponse.next();

  const gateUrl = new URL('/beta-gate', req.url);
  gateUrl.searchParams.set('from', pathname);
  return NextResponse.redirect(gateUrl);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
