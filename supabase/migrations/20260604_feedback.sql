create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  message text not null,
  email text,
  type text not null default 'general',
  context text,
  created_at timestamptz not null default now()
);

-- Allow the service role (used by supabaseAdmin) to insert
alter table public.feedback enable row level security;

create policy "Service role can insert feedback"
  on public.feedback
  for insert
  to service_role
  with check (true);

create policy "Service role can read feedback"
  on public.feedback
  for select
  to service_role
  using (true);
