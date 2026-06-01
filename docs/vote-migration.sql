create table if not exists feature_requests (
  id uuid default gen_random_uuid() primary key,
  title text not null,
  description text,
  status text default 'open' check (status in ('open', 'planned', 'in_progress', 'done')),
  vote_count integer default 0 not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz default now() not null
);

create table if not exists feature_votes (
  user_id uuid references auth.users(id) on delete cascade,
  request_id uuid references feature_requests(id) on delete cascade,
  created_at timestamptz default now(),
  primary key (user_id, request_id)
);

-- Seed with the vision items from the roadmap
insert into feature_requests (title, description, status) values
  ('iOS + Android App', 'Full native apps on the App Store and Play Store.', 'planned'),
  ('Cross-Device Handoff', 'Start on your phone, continue on your desktop. Seamless.', 'planned'),
  ('Self-Hosted AI Model', 'Faster responses, lower cost, zero external limits.', 'planned'),
  ('Based for Teams', 'Shared workspace, shared memory, org billing.', 'open'),
  ('Custom Domain Publishing', 'Publish your generated app to your own URL in one click.', 'open')
on conflict do nothing;
