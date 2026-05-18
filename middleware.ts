import { NextRequest, NextResponse } from 'next/server';

export function middleware(req: NextRequest) {
  const betaCode = process.env.BETA_ACCESS_CODE;
  if (!betaCode) return NextResponse.next(); // no code set → gate inactive (production)

  const { pathname } = req.nextUrl;

  // Always allow the gate page and its API through
  if (
    pathname.startsWith('/beta-gate') ||
    pathname.startsWith('/api/beta-gate') ||
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
