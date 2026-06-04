import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../_auth';
import { mergeProjectToHtml } from '@/lib/mergeFiles';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { data } = await supabaseAdmin.from('shares').select('files').eq('id', id).single();

  if (!data) return new NextResponse('Not found', { status: 404 });

  // Combine HTML + CSS + JS into a single self-contained document so the gallery
  // thumbnail renders with full styling (CSS/JS are separate files that have no
  // URL in this context — referenced relative paths would 404).
  const html = mergeProjectToHtml(data.files ?? []);
  if (!html) return new NextResponse('Not found', { status: 404 });

  return new NextResponse(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
