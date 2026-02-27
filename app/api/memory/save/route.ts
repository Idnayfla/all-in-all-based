import { NextRequest, NextResponse } from 'next/server';
import { createClient } from 'redis';

export async function POST(req: NextRequest) {
  const redis = createClient({ url: process.env.REDIS_URL });
  try {
    const { memory } = await req.json();
    await redis.connect();
    await redis.set('based_memory', memory);
    await redis.disconnect();
    return NextResponse.json({ success: true });
  } catch (err: any) {
    try { await redis.disconnect(); } catch {}
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}