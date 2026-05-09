import { createClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';

export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

export async function getUserId(req: NextRequest): Promise<string> {
  const token = req.headers.get('Authorization')?.replace('Bearer ', '');
  if (!token) throw new Error('Unauthorized');
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) throw new Error('Unauthorized');
  return user.id;
}
