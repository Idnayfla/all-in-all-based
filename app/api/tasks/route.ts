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
//     entity_id uuid,
//     google_event_id text,
//     created_at timestamptz DEFAULT now(),
//     updated_at timestamptz DEFAULT now()
//   );
//   ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
//   CREATE POLICY "Users manage own tasks" ON tasks FOR ALL USING (auth.uid() = user_id);
//   -- migration: ALTER TABLE tasks ADD COLUMN IF NOT EXISTS google_event_id text;
// ─────────────────────────────────────────────────────────────────────────────
import { NextRequest, NextResponse } from 'next/server';
import { getUserId, supabaseAdmin } from '../_auth';
import { getValidAccessToken, createEvent, updateEvent, deleteEvent } from '@/lib/googleCalendar';

const SELECT_COLS =
  'id, title, notes, due_date, due_time, duration_minutes, tz_offset, priority, status, tags, entity_id, google_event_id, created_at, updated_at';

const PRIORITIES = ['urgent', 'high', 'normal', 'low'];
const STATUSES = ['todo', 'in_progress', 'done', 'cancelled'];

type TaskRow = {
  id: string;
  title: string;
  notes: string | null;
  due_date: string | null;
  due_time: string | null;
  duration_minutes: number | null;
  tz_offset: string | null;
  priority: string;
  status: string;
  tags: string[];
  entity_id: string | null;
  google_event_id: string | null;
  created_at: string;
  updated_at: string;
};

// ── Calendar sync helpers (all fire-and-forget, never block the response) ────

function timeOpts(task: TaskRow) {
  return {
    dueTime: task.due_time,
    durationMinutes: task.duration_minutes,
    tzOffset: task.tz_offset,
  };
}

async function calCreate(userId: string, task: TaskRow): Promise<void> {
  if (!task.due_date) return;
  const accessToken = await getValidAccessToken(userId);
  if (!accessToken) return;
  const event = await createEvent(
    accessToken,
    task.title,
    task.due_date,
    task.notes,
    timeOpts(task)
  );
  await supabaseAdmin.from('tasks').update({ google_event_id: event.id }).eq('id', task.id);
}

async function calSync(userId: string, task: TaskRow, removeEvent: boolean): Promise<void> {
  const accessToken = await getValidAccessToken(userId);
  if (!accessToken) return;
  if (removeEvent || !task.due_date) {
    if (task.google_event_id) {
      await deleteEvent(accessToken, task.google_event_id);
      await supabaseAdmin.from('tasks').update({ google_event_id: null }).eq('id', task.id);
    }
    return;
  }
  if (task.google_event_id) {
    await updateEvent(
      accessToken,
      task.google_event_id,
      task.title,
      task.due_date,
      task.notes,
      timeOpts(task)
    );
  } else {
    const event = await createEvent(
      accessToken,
      task.title,
      task.due_date,
      task.notes,
      timeOpts(task)
    );
    await supabaseAdmin.from('tasks').update({ google_event_id: event.id }).eq('id', task.id);
  }
}

async function calDelete(userId: string, eventId: string): Promise<void> {
  const accessToken = await getValidAccessToken(userId);
  if (!accessToken) return;
  await deleteEvent(accessToken, eventId);
}

// ── Route handlers ────────────────────────────────────────────────────────────

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
        due_time: body.due_time ?? null,
        duration_minutes: typeof body.duration_minutes === 'number' ? body.duration_minutes : null,
        tz_offset: body.tz_offset ?? null,
        priority,
        status: STATUSES.includes(body.status) ? body.status : 'todo',
        tags: Array.isArray(body.tags) ? body.tags : [],
        entity_id: body.entity_id ?? null,
      })
      .select(SELECT_COLS)
      .single();
    if (error) throw error;
    // Auto-create calendar event if task has a due date
    calCreate(userId, data as TaskRow).catch(() => {});
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
    if ('due_time' in body) updates.due_time = body.due_time;
    if ('duration_minutes' in body) updates.duration_minutes = body.duration_minutes;
    if ('tz_offset' in body) updates.tz_offset = body.tz_offset;
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

    const contentChanged =
      'title' in body ||
      'due_date' in body ||
      'due_time' in body ||
      'duration_minutes' in body ||
      'notes' in body;
    const statusComplete = body.status === 'done' || body.status === 'cancelled';
    if (contentChanged || statusComplete) {
      calSync(userId, data as TaskRow, statusComplete).catch(() => {});
    }

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

    // Fetch google_event_id before deleting so we can clean up the calendar event
    const { data: existing } = await supabaseAdmin
      .from('tasks')
      .select('google_event_id')
      .eq('id', id)
      .eq('user_id', userId)
      .single();

    const { error } = await supabaseAdmin.from('tasks').delete().eq('id', id).eq('user_id', userId);
    if (error) throw error;

    if (existing?.google_event_id) {
      calDelete(userId, existing.google_event_id as string).catch(() => {});
    }

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === 'Unauthorized')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
