import { NextRequest, NextResponse } from 'next/server';
import { getUserId, supabaseAdmin } from '../../_auth';

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

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await getUserId(req);
    const { id: requestId } = await params;

    // Check if the user has already voted
    const { data: existing, error: checkError } = await supabaseAdmin
      .from('feature_votes')
      .select('user_id')
      .eq('user_id', userId)
      .eq('request_id', requestId)
      .maybeSingle();

    if (checkError) {
      if (isTableMissing(checkError)) {
        return NextResponse.json({ error: 'Tables not ready' }, { status: 503 });
      }
      throw checkError;
    }

    let voted: boolean;

    if (existing) {
      // Remove vote
      const { error: delError } = await supabaseAdmin
        .from('feature_votes')
        .delete()
        .eq('user_id', userId)
        .eq('request_id', requestId);
      if (delError) throw delError;

      const { error: decError } = await supabaseAdmin.rpc('decrement_vote_count', {
        request_id: requestId,
      });
      if (decError) {
        // Fallback: read then decrement
        const { data: cur } = await supabaseAdmin
          .from('feature_requests')
          .select('vote_count')
          .eq('id', requestId)
          .single();
        const newCount = Math.max(0, ((cur as { vote_count: number } | null)?.vote_count ?? 1) - 1);
        await supabaseAdmin
          .from('feature_requests')
          .update({ vote_count: newCount })
          .eq('id', requestId);
      }
      voted = false;
    } else {
      // Add vote
      const { error: insError } = await supabaseAdmin
        .from('feature_votes')
        .insert({ user_id: userId, request_id: requestId });
      if (insError) throw insError;

      const { error: incError } = await supabaseAdmin.rpc('increment_vote_count', {
        request_id: requestId,
      });
      if (incError) {
        // Fallback: fetch current and increment
        const { data: cur } = await supabaseAdmin
          .from('feature_requests')
          .select('vote_count')
          .eq('id', requestId)
          .single();
        const newCount = ((cur as { vote_count: number } | null)?.vote_count ?? 0) + 1;
        await supabaseAdmin
          .from('feature_requests')
          .update({ vote_count: newCount })
          .eq('id', requestId);
      }
      voted = true;
    }

    // Return fresh vote count
    const { data: updated, error: fetchError } = await supabaseAdmin
      .from('feature_requests')
      .select('vote_count')
      .eq('id', requestId)
      .single();
    if (fetchError) throw fetchError;

    return NextResponse.json({
      voted,
      vote_count: (updated as { vote_count: number }).vote_count,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
