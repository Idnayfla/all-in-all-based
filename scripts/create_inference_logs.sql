-- inference_logs: training data collection for future fine-tuning
-- Run once in Supabase SQL editor.
-- Stores every (prompt, response, model, project_type) pair so we can
-- build a QLoRA fine-tune dataset at ~500 paying users.

create table if not exists inference_logs (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  user_id       uuid references auth.users(id) on delete set null,
  session_id    text,
  model         text not null,
  project_type  text,
  prompt        text not null,
  response      text not null,
  input_tokens  int,
  output_tokens int,
  latency_ms    int,
  provider      text default 'anthropic'   -- anthropic | pantheon | groq
);

-- Row-level security: users can read their own rows; service role writes
alter table inference_logs enable row level security;

create policy "users read own logs"
  on inference_logs for select
  using (auth.uid() = user_id);

-- Allow service role full access (no explicit policy needed — service role bypasses RLS)

-- Indexes for analytics queries
create index if not exists idx_inference_logs_user      on inference_logs(user_id);
create index if not exists idx_inference_logs_created   on inference_logs(created_at desc);
create index if not exists idx_inference_logs_model     on inference_logs(model);
create index if not exists idx_inference_logs_type      on inference_logs(project_type);
