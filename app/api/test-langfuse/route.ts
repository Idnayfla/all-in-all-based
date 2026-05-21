import { NextResponse } from 'next/server';
import { createLangfuseClient } from '@/lib/langfuse';

export async function GET() {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const keys = {
    hasPublic: !!process.env.LANGFUSE_PUBLIC_KEY,
    hasSecret: !!process.env.LANGFUSE_SECRET_KEY,
    host: process.env.LANGFUSE_HOST ?? '(not set)',
    publicKeyPrefix: process.env.LANGFUSE_PUBLIC_KEY?.slice(0, 8) ?? '(empty)',
    secretKeyPrefix: process.env.LANGFUSE_SECRET_KEY?.slice(0, 8) ?? '(empty)',
  };

  const lf = createLangfuseClient();
  if (!lf) {
    return NextResponse.json({ status: 'no-client', keys });
  }

  try {
    const trace = lf.trace({
      name: 'connection-test',
      input: { test: true, timestamp: new Date().toISOString() },
    });
    trace.span({ name: 'test-span' }).end({ output: { ok: true } });
    await lf.shutdownAsync();
    return NextResponse.json({ status: 'ok', traceId: trace.id, keys });
  } catch (err: unknown) {
    return NextResponse.json(
      { status: 'error', error: err instanceof Error ? err.message : String(err), keys },
      { status: 500 }
    );
  }
}
