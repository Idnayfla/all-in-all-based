import { NextRequest, NextResponse } from 'next/server';
import { getUserId, supabaseAdmin } from '@/app/api/_auth';

const BUCKET = 'pdf-uploads';

async function ensureBucket() {
  const { error } = await supabaseAdmin.storage.createBucket(BUCKET, { public: false });
  if (error && !error.message.includes('already exists')) {
    console.error('[Based/pdf-upload-url] bucket create failed:', error.message);
  }
}

export async function POST(req: NextRequest) {
  let userId: string;
  try {
    userId = await getUserId(req);
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { filename } = await req.json();
  if (!filename || typeof filename !== 'string') {
    return NextResponse.json({ error: 'filename required' }, { status: 400 });
  }
  if (!filename.toLowerCase().endsWith('.pdf')) {
    return NextResponse.json({ error: 'Only PDF files are allowed' }, { status: 400 });
  }

  await ensureBucket();

  const key = `${userId}/${Date.now()}-${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  const { data, error } = await supabaseAdmin.storage.from(BUCKET).createSignedUploadUrl(key, {
    upsert: true,
  });

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? 'Failed to create upload URL' },
      { status: 500 }
    );
  }

  return NextResponse.json({ signedUrl: data.signedUrl, key });
}
