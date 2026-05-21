import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../_auth';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { data } = await supabaseAdmin.from('shares').select('files').eq('id', id).single();

  if (!data) return new NextResponse('Not found', { status: 404 });

  const htmlFile =
    data.files.find((f: { name: string }) => f.name === 'index.html') ?? data.files[0];
  if (!htmlFile) return new NextResponse('Not found', { status: 404 });

  return new NextResponse(htmlFile.content as string, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
