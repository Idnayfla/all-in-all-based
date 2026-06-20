import { createClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';

export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

export async function getUserId(req: NextRequest): Promise<string> {
  const token = req.headers.get('Authorization')?.replace('Bearer ', '');
  if (!token) throw new Error('Unauthorized');
  const {
    data: { user },
    error,
  } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) throw new Error('Unauthorized');
  return user.id;
}

// Server-side broadcast via Supabase REST API — reliable in serverless (no WebSocket needed).
// The WebSocket-based channel.subscribe().send() pattern is unreliable on Vercel because
// the subscribe() call returns immediately without waiting for the connection to establish.
export async function broadcastToRoom(
  roomId: string,
  event: string,
  payload: object
): Promise<void> {
  await fetch(
    `${process.env.NEXT_PUBLIC_SUPABASE_URL}/realtime/v1/api/broadcast`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: process.env.SUPABASE_SERVICE_KEY!,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY!}`,
      },
      body: JSON.stringify({
        messages: [{ topic: `realtime:group:${roomId}`, event, payload }],
      }),
    }
  );
}

export async function requireAdmin(req: NextRequest): Promise<void> {
  const token = req.headers.get('Authorization')?.replace('Bearer ', '');
  if (!token) throw new Error('Unauthorized');
  const {
    data: { user },
    error,
  } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) throw new Error('Unauthorized');
  const adminEmail = process.env.BASED_ADMIN_EMAIL ?? 'husgogogo@gmail.com';
  if (user.email !== adminEmail) throw new Error('Forbidden');
}
