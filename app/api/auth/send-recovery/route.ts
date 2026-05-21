import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import { supabaseAdmin } from '../../_auth';

const resend = new Resend(process.env.RESEND_API_KEY);

export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json();
    if (!email?.trim()) {
      return NextResponse.json({ error: 'Email required' }, { status: 400 });
    }

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
    const { data, error } = await supabaseAdmin.auth.admin.generateLink({
      type: 'recovery',
      email: email.trim(),
      ...(siteUrl && { options: { redirectTo: `${siteUrl}/auth/callback` } }),
    });

    if (error || !data?.properties?.action_link) {
      return NextResponse.json(
        { error: error?.message ?? 'No action link returned' },
        { status: 500 }
      );
    }

    const { error: sendError } = await resend.emails.send({
      from: 'Based <noreply@getbased.dev>',
      to: email.trim(),
      subject: 'Reset your Based password',
      html: `
        <div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:40px 24px;background:#0d0d0d;color:#e0e0e0;">
          <div style="font-size:24px;font-weight:700;color:#7c6af7;letter-spacing:2px;margin-bottom:24px;">B&gt;</div>
          <h2 style="font-size:20px;font-weight:600;margin:0 0 12px;">Reset your password</h2>
          <p style="color:#a0a0a0;font-size:14px;margin:0 0 24px;line-height:1.6;">
            Click the button below to reset your password. This link expires in 1 hour.
          </p>
          <a href="${data.properties.action_link}"
             style="display:inline-block;padding:12px 24px;background:#7c6af7;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;font-size:14px;">
            Reset Password
          </a>
          <p style="color:#666;font-size:12px;margin-top:24px;">
            If you didn't request this, you can safely ignore this email.
          </p>
        </div>
      `,
    });

    if (sendError) {
      return NextResponse.json({ error: sendError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
