import { NextRequest, NextResponse } from 'next/server';
import { getUserId, supabaseAdmin } from '../../_auth';

const ALLOWED_TYPES = new Set([
  // Images
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  // Documents
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'text/csv',
  'application/rtf',
  // Archives
  'application/zip',
  'application/x-zip-compressed',
  'application/x-rar-compressed',
  'application/x-7z-compressed',
  'application/gzip',
  'application/x-tar',
]);

export async function POST(req: NextRequest) {
  const userId = await getUserId(req);
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    filename?: string;
    content_type?: string;
  };
  const filename = (body.filename ?? 'file').replace(/[^a-zA-Z0-9._-]/g, '_');
  const contentType = body.content_type ?? 'application/octet-stream';

  if (!ALLOWED_TYPES.has(contentType)) {
    return NextResponse.json({ error: 'Unsupported file type' }, { status: 400 });
  }

  const path = `${userId}/${Date.now()}_${filename}`;
  const { data, error } = await supabaseAdmin.storage
    .from('group-media')
    .createSignedUploadUrl(path);

  if (error || !data) {
    return NextResponse.json({ error: 'Upload init failed' }, { status: 500 });
  }

  const publicUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/group-media/${path}`;

  return NextResponse.json({
    upload_url: data.signedUrl,
    token: data.token,
    path,
    public_url: publicUrl,
    content_type: contentType,
  });
}
