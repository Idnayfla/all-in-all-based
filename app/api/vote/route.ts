import { NextRequest, NextResponse } from 'next/server';
import { getUserId, supabaseAdmin } from '../_auth';

type FeatureRequest = {
  id: string;
  title: string;
  description: string | null;
  status: 'open' | 'planned' | 'in_progress' | 'done';
  vote_count: number;
  created_by: string | null;
  created_at: string;
  voted?: boolean;
};

function isTableMissing(err: unknown): boolean {
  if (err && typeof err === 'object' && 'code' in err) {
    const code = (err as { code: string }).code;
    return code === '42P01' || code === 'PGRST116';
  }
  if (err instanceof Error) {
    return (
      err.message.includes('does not exist') ||
      err.message.includes('relation') ||
      err.message.includes('42P01')
    );
  }
  return false;
}

export async function GET(req: NextRequest) {
  try {
    // Auth is optional for GET — unauthenticated users can still list
    let userId: string | null = null;
    try {
      userId = await getUserId(req);
    } catch {
      userId = null;
    }

    const { data: requests, error: reqError } = await supabaseAdmin
      .from('feature_requests')
      .select('id, title, description, status, vote_count, created_by, created_at')
      .order('vote_count', { ascending: false })
      .order('created_at', { ascending: true });

    if (reqError) {
      if (isTableMissing(reqError)) {
        return NextResponse.json([]);
      }
      throw reqError;
    }

    const rows = (requests ?? []) as FeatureRequest[];

    if (userId && rows.length > 0) {
      const ids = rows.map(r => r.id);
      const { data: votes } = await supabaseAdmin
        .from('feature_votes')
        .select('request_id')
        .eq('user_id', userId)
        .in('request_id', ids);

      const votedSet = new Set((votes ?? []).map((v: { request_id: string }) => v.request_id));
      for (const row of rows) {
        row.voted = votedSet.has(row.id);
      }
    } else {
      for (const row of rows) {
        row.voted = false;
      }
    }

    return NextResponse.json(rows);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const userId = await getUserId(req);
    const body = (await req.json()) as { title?: string; description?: string };
    const title = (body.title ?? '').trim().slice(0, 120);
    if (!title) {
      return NextResponse.json({ error: 'Title is required' }, { status: 400 });
    }
    const description = body.description ? body.description.trim().slice(0, 500) : null;

    const { data, error } = await supabaseAdmin
      .from('feature_requests')
      .insert({
        title,
        description: description || null,
        status: 'open',
        vote_count: 0,
        created_by: userId,
      })
      .select('id, title, description, status, vote_count, created_by, created_at')
      .single();

    if (error) {
      if (isTableMissing(error)) {
        return NextResponse.json({ error: 'Feature requests table not ready' }, { status: 503 });
      }
      throw error;
    }

    return NextResponse.json({ ...data, voted: false });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
