create table if not exists public.feature_requests (
  id uuid primary key default gen_random_uuid(),
  created_by uuid references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 5 and 120),
  description text check (char_length(description) <= 500),
  status text not null default 'open' check (status in ('open', 'planned', 'in_progress', 'done')),
  vote_count integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.feature_votes (
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null references public.feature_requests(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, request_id)
);

alter table public.feature_requests enable row level security;
alter table public.feature_votes enable row level security;

create policy "Anyone can read requests" on public.feature_requests for select using (true);
create policy "Auth users can insert requests" on public.feature_requests for insert with check (auth.uid() = created_by);
create policy "Auth users can read own votes" on public.feature_votes for select using (auth.uid() = user_id);
create policy "Auth users can vote" on public.feature_votes for insert with check (auth.uid() = user_id);
create policy "Auth users can unvote" on public.feature_votes for delete using (auth.uid() = user_id);

-- RPC: increment vote_count atomically
create or replace function public.increment_vote_count(request_id uuid)
returns void language sql security definer as $$
  update public.feature_requests
  set vote_count = vote_count + 1
  where id = request_id;
$$;

-- RPC: decrement vote_count atomically (floor 0)
create or replace function public.decrement_vote_count(request_id uuid)
returns void language sql security definer as $$
  update public.feature_requests
  set vote_count = greatest(0, vote_count - 1)
  where id = request_id;
$$;

-- Seed data so the page is never empty on first load
insert into public.feature_requests (id, created_by, title, description, status, vote_count) values
  ('a1b2c3d4-e5f6-7890-abcd-ef1234567801', null,
   'Android floating bubble stability',
   'The bubble disappears after switching apps or during calls. Needs to auto-restart and stay persistent across all system events.',
   'planned', 28),
  ('a1b2c3d4-e5f6-7890-abcd-ef1234567802', null,
   'Based learns my daily schedule automatically',
   'Based should recognise recurring routines — meetings, workouts, commute — and proactively offer help at the right moment without being asked.',
   'open', 21),
  ('a1b2c3d4-e5f6-7890-abcd-ef1234567803', null,
   'Export chat history as PDF or Markdown',
   'Let users download their full conversation history with Based. Useful for journaling, reflection, and keeping records outside the app.',
   'open', 17),
  ('a1b2c3d4-e5f6-7890-abcd-ef1234567804', null,
   'Based integration with Notion',
   'Read and write Notion pages from the companion — take notes, search docs, update databases — without switching apps.',
   'open', 14),
  ('a1b2c3d4-e5f6-7890-abcd-ef1234567805', null,
   'Voice transcription accuracy improvements',
   'Whisper sometimes mishears "Based" and struggles with accented English. Evaluating Deepgram Nova-3 with keyword boosting as an alternative.',
   'in_progress', 11),
  ('a1b2c3d4-e5f6-7890-abcd-ef1234567806', null,
   'Dark / light mode toggle',
   'Some users prefer a lighter interface, especially outdoors or on high-brightness screens. Add a theme toggle in Settings.',
   'open', 8)
on conflict (id) do nothing;
