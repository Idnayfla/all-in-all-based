// ─────────────────────────────────────────────────────────────────────────────
// Run this in the Supabase SQL editor once to provision the tasks table.
// (We can't run migrations from the app, so this is the source of truth.)
//
//   CREATE TABLE IF NOT EXISTS tasks (
//     id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
//     user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
//     title text NOT NULL,
//     notes text,
//     due_date timestamptz,
//     priority text DEFAULT 'normal' CHECK (priority IN ('urgent', 'high', 'normal', 'low')),
//     status text DEFAULT 'todo' CHECK (status IN ('todo', 'in_progress', 'done', 'cancelled')),
//     tags text[] DEFAULT '{}',
//     entity_id uuid, -- optional link to an entity node
//     created_at timestamptz DEFAULT now(),
//     updated_at timestamptz DEFAULT now()
//   );
//   ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
//   CREATE POLICY "Users manage own tasks" ON tasks FOR ALL USING (auth.uid() = user_id);
// ─────────────────────────────────────────────────────────────────────────────
import { NextRequest, NextResponse } from 'next/server';
import { getUserId, supabaseAdmin } from '../_auth';

const SELECT_COLS =
  'id, title, notes, due_date, priority, status, tags, entity_id, created_at, updated_at';

const PRIORITIES = ['urgent', 'high', 'normal', 'low'];
const STATUSES = ['todo', 'in_progress', 'done', 'cancelled'];

export async function GET(req: NextRequest) {
  try {
    const userId = await getUserId(req);
    const { searchParams } = new URL(req.url);
    const status = searchParams.get('status');
    const dueToday = searchParams.get('due_today') === 'true';
    const entityId = searchParams.get('entity_id');

    let query = supabaseAdmin
      .from('tasks')
      .select(SELECT_COLS)
      .eq('user_id', userId)
      .order('due_date', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: false });

    if (status && STATUSES.includes(status)) {
      query = query.eq('status', status);
    }
    if (entityId) {
      query = query.eq('entity_id', entityId);
    }
    if (dueToday) {
      // End of today (local server time approximation in ISO) — anything due now or
      // overdue counts. We compare against end-of-day so same-day tasks are included.
      const end = new Date();
      end.setHours(23, 59, 59, 999);
      query = query.lte('due_date', end.toISOString()).not('due_date', 'is', null);
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
    const body = await req.json();
    if (!body.title || typeof body.title !== 'string') {
      return NextResponse.json({ error: 'title is required' }, { status: 400 });
    }
    const priority = PRIORITIES.includes(body.priority) ? body.priority : 'normal';
    const { data, error } = await supabaseAdmin
      .from('tasks')
      .insert({
        user_id: userId,
        title: body.title.slice(0, 500),
        notes: body.notes ?? null,
        due_date: body.due_date ?? null,
        priority,
        status: STATUSES.includes(body.status) ? body.status : 'todo',
        tags: Array.isArray(body.tags) ? body.tags : [],
        entity_id: body.entity_id ?? null,
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

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (typeof body.title === 'string') updates.title = body.title.slice(0, 500);
    if ('notes' in body) updates.notes = body.notes;
    if ('due_date' in body) updates.due_date = body.due_date;
    if (PRIORITIES.includes(body.priority)) updates.priority = body.priority;
    if (STATUSES.includes(body.status)) updates.status = body.status;
    if (Array.isArray(body.tags)) updates.tags = body.tags;
    if ('entity_id' in body) updates.entity_id = body.entity_id;

    const { data, error } = await supabaseAdmin
      .from('tasks')
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
    const { error } = await supabaseAdmin.from('tasks').delete().eq('id', id).eq('user_id', userId);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === 'Unauthorized')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
