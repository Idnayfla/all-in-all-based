import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const response = NextResponse.next();
  if (request.nextUrl.pathname === '/companion') {
    // SharedArrayBuffer (required by ort-wasm-simd-threaded for Silero VAD)
    // needs cross-origin isolation. next.config.ts headers() doesn't apply
    // in Turbopack dev mode, so we set them here via middleware.
    response.headers.set('Cross-Origin-Opener-Policy', 'same-origin');
    response.headers.set('Cross-Origin-Embedder-Policy', 'credentialless');
  }
  return response;
}

export const config = { matcher: ['/companion'] };
