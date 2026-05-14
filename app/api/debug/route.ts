import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../_auth';

export async function GET() {
  const results: Record<string, unknown> = {};

  // Test projects table
  const { data: projectsData, error: projectsError } = await supabaseAdmin
    .from('projects')
    .select('id')
    .limit(1);
  results.projects_table = projectsError
    ? { ok: false, error: projectsError.message, code: projectsError.code }
    : { ok: true, row_count: projectsData?.length };

  // Test user_settings table + check columns
  const { data: settingsData, error: settingsError } = await supabaseAdmin
    .from('user_settings')
    .select('user_id, global_memory, personality, theme')
    .limit(1);
  results.user_settings_table = settingsError
    ? { ok: false, error: settingsError.message, code: settingsError.code }
    : { ok: true, row_count: settingsData?.length };

  // Test a dry-run INSERT into projects (then immediately delete)
  const testId = '00000000-0000-0000-0000-000000000001';
  const { error: insertError } = await supabaseAdmin
    .from('projects')
    .insert({ id: testId, user_id: '00000000-0000-0000-0000-000000000000', name: '__debug_test__', files: [], messages: [], memory: '' });

  if (!insertError) {
    await supabaseAdmin.from('projects').delete().eq('id', testId);
    results.insert_test = { ok: true };
  } else {
    results.insert_test = { ok: false, error: insertError.message, code: insertError.code };
  }

  results.env = {
    supabase_url: process.env.NEXT_PUBLIC_SUPABASE_URL ? 'set' : 'MISSING',
    service_key: process.env.SUPABASE_SERVICE_KEY ? 'set' : 'MISSING',
    anthropic_key: process.env.APP_ANTHROPIC_API_KEY ? 'set' : 'MISSING',
  };

  const allOk = (results.projects_table as any).ok && (results.user_settings_table as any).ok && (results.insert_test as any).ok;
  return NextResponse.json({ status: allOk ? 'healthy' : 'errors_found', ...results });
}
