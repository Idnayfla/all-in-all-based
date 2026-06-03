import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import { supabaseAdmin } from '../../_auth';

const resend = new Resend(process.env.RESEND_API_KEY ?? 'placeholder_not_configured');

const BATCH_SIZE = 100;

function isAuthorized(req: NextRequest): boolean {
  const secret = req.headers.get('x-admin-secret');
  return !!process.env.ADMIN_SECRET && secret === process.env.ADMIN_SECRET;
}

type ShipBody = {
  requestId: string;
  changelogLabel?: string;
  changelogTitle?: string;
  changelogAnchor?: string;
};

type BatchEmail = {
  from: string;
  to: string;
  subject: string;
  html: string;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function buildEmailHtml(
  title: string,
  versionLine: string,
  shareUrl: string,
  changelogUrl: string
): string {
  return `
    <div style="font-family:ui-monospace,monospace,system-ui,sans-serif;max-width:520px;margin:0 auto;padding:48px 28px;background:#0d0d0d;color:#e0e0e0;">
      <div style="font-size:22px;font-weight:700;color:#7c6af7;letter-spacing:2px;margin-bottom:32px;">B&gt;</div>

      <p style="font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#5ef5c0;margin:0 0 16px;">
        &#9672; You asked, we built it
      </p>

      <h2 style="font-size:22px;font-weight:600;margin:0 0 8px;color:#f0f0f8;line-height:1.3;font-family:ui-monospace,monospace;">
        ${title}
      </h2>

      <p style="color:#8888a8;font-size:14px;margin:0 0 4px;">
        Shipped in ${versionLine}
      </p>
      <p style="color:#666688;font-size:13px;margin:0 0 32px;">
        Your vote helped make this happen.
      </p>

      <a href="${shareUrl}"
         style="display:inline-block;padding:12px 24px;background:#5ef5c0;color:#0d0d0d;text-decoration:none;border-radius:100px;font-weight:700;font-size:13px;letter-spacing:0.02em;">
        &#9672; See what shipped &rarr;
      </a>

      <div style="margin-top:24px;">
        <a href="${changelogUrl}" style="color:#8888a8;font-size:13px;text-decoration:none;display:block;">
          &rarr; View in changelog
        </a>
        <a href="https://getbased.dev/vote" style="color:#8888a8;font-size:13px;text-decoration:none;display:block;margin-top:8px;">
          &rarr; Vote on what&apos;s next
        </a>
      </div>

      <div style="margin-top:40px;padding-top:20px;border-top:1px solid #222;color:#555;font-size:12px;line-height:1.6;">
        You&apos;re receiving this because you voted for this feature on Based.<br/>
        <a href="https://getbased.dev" style="color:#666;text-decoration:none;">getbased.dev</a>
      </div>
    </div>
  `;
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: ShipBody;
  try {
    body = (await req.json()) as ShipBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { requestId, changelogLabel, changelogTitle, changelogAnchor } = body;
  if (!requestId?.trim()) {
    return NextResponse.json({ error: 'requestId required' }, { status: 400 });
  }
  if (!UUID_RE.test(requestId.trim())) {
    return NextResponse.json({ error: 'requestId must be a valid UUID' }, { status: 400 });
  }

  try {
    // 1. Fetch the feature request
    const { data: request, error: reqError } = await supabaseAdmin
      .from('feature_requests')
      .select('id, title, status')
      .eq('id', requestId)
      .maybeSingle();

    if (reqError || !request) {
      return NextResponse.json({ error: 'Feature request not found' }, { status: 404 });
    }

    // 2. Mark as done — idempotent
    if ((request as { status: string }).status !== 'done') {
      const { error: updateError } = await supabaseAdmin
        .from('feature_requests')
        .update({ status: 'done' })
        .eq('id', requestId);
      if (updateError) throw updateError;
    }

    // 3. Get all voters
    const { data: votes, error: votesError } = await supabaseAdmin
      .from('feature_votes')
      .select('user_id')
      .eq('request_id', requestId);

    if (votesError) throw votesError;

    const voterIds = (votes ?? []).map((v: { user_id: string }) => v.user_id);

    if (voterIds.length === 0) {
      return NextResponse.json({
        success: true,
        shipped: true,
        votersFound: 0,
        pendingNotifications: 0,
        emailsSent: 0,
        note: 'No voters to notify',
      });
    }

    // 4. Filter out already-notified voters (idempotency via email log)
    const { data: alreadySent } = await supabaseAdmin
      .from('feature_email_log')
      .select('user_id')
      .eq('request_id', requestId)
      .in('user_id', voterIds);

    const sentSet = new Set((alreadySent ?? []).map((r: { user_id: string }) => r.user_id));
    const pendingIds = voterIds.filter(id => !sentSet.has(id));

    if (pendingIds.length === 0) {
      return NextResponse.json({
        success: true,
        shipped: true,
        votersFound: voterIds.length,
        pendingNotifications: 0,
        emailsSent: 0,
        note: 'All voters already notified',
      });
    }

    // 5. Resolve voter emails in parallel
    const userResults = await Promise.allSettled(
      pendingIds.map(userId => supabaseAdmin.auth.admin.getUserById(userId))
    );

    const toSend: Array<{ email: string; userId: string }> = [];
    for (let i = 0; i < pendingIds.length; i++) {
      const result = userResults[i];
      if (result.status === 'fulfilled' && result.value.data?.user?.email) {
        toSend.push({ email: result.value.data.user.email, userId: pendingIds[i] });
      }
    }

    if (toSend.length === 0) {
      return NextResponse.json({
        success: true,
        shipped: true,
        votersFound: voterIds.length,
        pendingNotifications: pendingIds.length,
        emailsSent: 0,
        note: 'No valid emails found for voters',
      });
    }

    // 6. Build email content
    const shareUrl = `https://getbased.dev/shipped/${requestId}`;
    const changelogUrl = changelogAnchor
      ? `https://getbased.dev/changelog#${changelogAnchor}`
      : 'https://getbased.dev/changelog';
    const versionLine =
      changelogLabel && changelogTitle
        ? `${changelogLabel} · ${changelogTitle}`
        : 'the latest release';
    const title = escapeHtml((request as { title: string }).title);
    const html = buildEmailHtml(title, versionLine, shareUrl, changelogUrl);
    const subject = `◈ Your request was built — ${title}`;

    // 7. Send in batches of 100, log each successful batch
    let emailsSent = 0;
    const sendErrors: string[] = [];

    for (let i = 0; i < toSend.length; i += BATCH_SIZE) {
      const chunk = toSend.slice(i, i + BATCH_SIZE);
      const batch: BatchEmail[] = chunk.map(({ email }) => ({
        from: 'Based <noreply@getbased.dev>',
        to: email,
        subject,
        html,
      }));

      try {
        const { error: batchError } = await resend.batch.send(batch);
        if (batchError) {
          sendErrors.push(batchError.message);
        } else {
          // Log sends — unique constraint prevents double-logging on retry
          const { error: logError } = await supabaseAdmin.from('feature_email_log').upsert(
            chunk.map(({ userId }) => ({ request_id: requestId, user_id: userId })),
            { onConflict: 'request_id,user_id', ignoreDuplicates: true }
          );
          if (logError) {
            sendErrors.push(`email log failed: ${logError.message}`);
          } else {
            emailsSent += chunk.length;
          }
        }
      } catch (e) {
        sendErrors.push(e instanceof Error ? e.message : 'batch send failed');
      }
    }

    return NextResponse.json({
      success: true,
      shipped: true,
      votersFound: voterIds.length,
      pendingNotifications: pendingIds.length,
      emailsSent,
      ...(sendErrors.length > 0 && { errors: sendErrors }),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
