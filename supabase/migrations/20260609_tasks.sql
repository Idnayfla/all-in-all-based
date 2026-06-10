CREATE TABLE IF NOT EXISTS tasks (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  notes text,
  due_date timestamptz,
  priority text DEFAULT 'normal' CHECK (priority IN ('urgent', 'high', 'normal', 'low')),
  status text DEFAULT 'todo' CHECK (status IN ('todo', 'in_progress', 'done', 'cancelled')),
  tags text[] DEFAULT '{}',
  entity_id uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own tasks" ON tasks
  FOR ALL USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS tasks_user_due_idx ON tasks (user_id, due_date);
CREATE INDEX IF NOT EXISTS tasks_user_status_idx ON tasks (user_id, status);
