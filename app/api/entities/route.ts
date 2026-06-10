// ─────────────────────────────────────────────────────────────────────────────
// Run this in the Supabase SQL editor once to provision the entities table.
// (We can't run migrations from the app, so this is the source of truth.)
//
//   CREATE TABLE IF NOT EXISTS entities (
//     id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
//     user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
//     name text NOT NULL,
//     type text NOT NULL CHECK (type IN ('project', 'person', 'topic', 'account', 'place', 'other')),
//     summary text, -- 1-2 sentence overview
//     content jsonb DEFAULT '{}', -- flexible: { followers, status, url, stats, ... }
//     notes text, -- freeform markdown notes
//     tags text[] DEFAULT '{}',
//     last_mentioned_at timestamptz DEFAULT now(),
//     created_at timestamptz DEFAULT now(),
//     updated_at timestamptz DEFAULT now()
//   );
//   ALTER TABLE entities ENABLE ROW LEVEL SECURITY;
//   CREATE POLICY "Users manage own entities" ON entities FOR ALL USING (auth.uid() = user_id);
//
//   -- Full text search index
//   CREATE INDEX IF NOT EXISTS entities_name_idx ON entities
//     USING gin(to_tsvector('english', name || ' ' || COALESCE(summary, '') || ' ' || COALESCE(notes, '')));
// ─────────────────────────────────────────────────────────────────────────────
import { NextRequest, NextResponse } from 'next/server';
import { getUserId, supabaseAdmin } from '../_auth';

const SELECT_COLS =
  'id, name, type, summary, content, notes, tags, last_mentioned_at, created_at, updated_at';

const TYPES = ['project', 'person', 'topic', 'account', 'place', 'other'];

export async function GET(req: NextRequest) {
  try {
    const userId = await getUserId(req);
    const { searchParams } = new URL(req.url);
    const search = searchParams.get('search');
    const type = searchParams.get('type');

    let query = supabaseAdmin
      .from('entities')
      .select(SELECT_COLS)
      .eq('user_id', userId)
      .order('last_mentioned_at', { ascending: false });

    if (type && TYPES.includes(type)) {
      query = query.eq('type', type);
    }
    if (search && search.trim()) {
      // ilike across name/summary/notes — simple, index-independent fuzzy match.
      const term = `%${search.trim()}%`;
      query = query.or(`name.ilike.${term},summary.ilike.${term},notes.ilike.${term}`);
    }

    const { data, error } = await query;
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
    const { searchParams } = new URL(req.url);
    const upsert = searchParams.get('upsert') === 'true';
    const body = await req.json();
    if (!body.name || typeof body.name !== 'string') {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }
    const type = TYPES.includes(body.type) ? body.type : 'other';
    const now = new Date().toISOString();

    if (upsert) {
      // Find existing entity by name (case-insensitive) for this user.
      const { data: existing } = await supabaseAdmin
        .from('entities')
        .select('id, content')
        .eq('user_id', userId)
        .ilike('name', body.name.trim())
        .limit(1);

      if (existing && existing.length > 0) {
        const mergedContent = {
          ...(existing[0].content ?? {}),
          ...(body.content ?? {}),
        };
        const updates: Record<string, unknown> = {
          type,
          content: mergedContent,
          last_mentioned_at: now,
          updated_at: now,
        };
        if (body.summary) updates.summary = body.summary;
        if (body.notes) updates.notes = body.notes;
        if (Array.isArray(body.tags)) updates.tags = body.tags;
        const { data, error } = await supabaseAdmin
          .from('entities')
          .update(updates)
          .eq('id', existing[0].id)
          .eq('user_id', userId)
          .select(SELECT_COLS)
          .single();
        if (error) throw error;
        return NextResponse.json(data);
      }
      // Falls through to insert below if no existing match.
    }

    const { data, error } = await supabaseAdmin
      .from('entities')
      .insert({
        user_id: userId,
        name: body.name.slice(0, 200),
        type,
        summary: body.summary ?? null,
        content: body.content ?? {},
        notes: body.notes ?? null,
        tags: Array.isArray(body.tags) ? body.tags : [],
        last_mentioned_at: now,
      })
      .select(SELECT_COLS)
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

export async function PATCH(req: NextRequest) {
  try {
    const userId = await getUserId(req);
    const body = await req.json();
    if (!body.id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
      last_mentioned_at: new Date().toISOString(),
    };
    if (typeof body.name === 'string') updates.name = body.name.slice(0, 200);
    if (TYPES.includes(body.type)) updates.type = body.type;
    if ('summary' in body) updates.summary = body.summary;
    if ('content' in body) updates.content = body.content;
    if ('notes' in body) updates.notes = body.notes;
    if (Array.isArray(body.tags)) updates.tags = body.tags;

    const { data, error } = await supabaseAdmin
      .from('entities')
      .update(updates)
      .eq('id', body.id)
      .eq('user_id', userId)
      .select(SELECT_COLS)
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

export async function DELETE(req: NextRequest) {
  try {
    const userId = await getUserId(req);
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
    const { error } = await supabaseAdmin
      .from('entities')
      .delete()
      .eq('id', id)
      .eq('user_id', userId);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === 'Unauthorized')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
