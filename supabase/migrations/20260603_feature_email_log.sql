-- Run this once in Supabase SQL editor before using /api/admin/ship-feature
-- Table: tracks which voters have already received a ship notification

create table if not exists feature_email_log (
  id         uuid        primary key default gen_random_uuid(),
  request_id uuid        not null references feature_requests(id) on delete cascade,
  user_id    uuid        not null,
  sent_at    timestamptz not null default now(),
  unique(request_id, user_id)
);

create index if not exists feature_email_log_request_id_idx
  on feature_email_log(request_id);
