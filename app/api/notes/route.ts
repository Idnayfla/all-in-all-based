// ─────────────────────────────────────────────────────────────────────────────
// Run this in the Supabase SQL editor once to provision the notes table.
// (We can't run migrations from the app, so this is the source of truth.)
//
//   CREATE TABLE IF NOT EXISTS notes (
//     id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
//     user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
//     title text NOT NULL DEFAULT 'Untitled Note',
//     content text NOT NULL DEFAULT '',
//     drawing_data text,            -- JSON-serialised draw strokes (rich Notes panel)
//     source text DEFAULT 'manual', -- 'chat' | 'manual'
//     created_at timestamptz DEFAULT now(),
//     updated_at timestamptz DEFAULT now()
//   );
//   ALTER TABLE notes ENABLE ROW LEVEL SECURITY;
//   CREATE POLICY "Users can manage their own notes" ON notes
//     FOR ALL USING (auth.uid() = user_id);
//
// If the table already exists without the `source` column, add it with:
//   ALTER TABLE notes ADD COLUMN IF NOT EXISTS source text DEFAULT 'manual';
// ─────────────────────────────────────────────────────────────────────────────
import { NextRequest, NextResponse } from 'next/server';
import { getUserId, supabaseAdmin } from '../_auth';

export async function GET(req: NextRequest) {
  try {
    const userId = await getUserId(req);
    const { data, error } = await supabaseAdmin
      .from('notes')
      .select('id, title, content, drawing_data, source, created_at, updated_at')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false });
    if (error) throw error;
    return NextResponse.json(data ?? []);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === 'Unauthorized')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const userId = await getUserId(req);
    const body = await req.json();
    const { data, error } = await supabaseAdmin
      .from('notes')
      .insert({
        user_id: userId,
        title: body.title ?? 'Untitled',
        content: body.content ?? '',
        drawing_data: body.drawing_data ?? null,
        source: body.source ?? 'manual',
      })
      .select('id, title, content, drawing_data, source, created_at, updated_at')
      .single();
    if (error) throw error;
    return NextResponse.json(data);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === 'Unauthorized')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
