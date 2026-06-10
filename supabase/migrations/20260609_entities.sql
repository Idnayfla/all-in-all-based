CREATE TABLE IF NOT EXISTS entities (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  type text NOT NULL CHECK (type IN ('project', 'person', 'topic', 'account', 'place', 'other')),
  summary text,
  content jsonb DEFAULT '{}',
  notes text,
  tags text[] DEFAULT '{}',
  last_mentioned_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE entities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own entities" ON entities
  FOR ALL USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS entities_user_name_idx ON entities (user_id, lower(name));
CREATE INDEX IF NOT EXISTS entities_last_mentioned_idx ON entities (user_id, last_mentioned_at DESC);
CREATE INDEX IF NOT EXISTS entities_fts_idx ON entities
  USING gin(to_tsvector('english', name || ' ' || COALESCE(summary, '') || ' ' || COALESCE(notes, '')));
