// Shared server-side helpers for the Tasks + Entity Memory "digital brain".
//
// These run against Supabase with the service-role client and an explicit
// user_id, so they are safe to call from the generate tool loop and the
// background memory extractor alike. They never trust client input for
// ownership — the caller always passes a verified userId.
import { supabaseAdmin } from '@/app/api/_auth';
import Anthropic from '@anthropic-ai/sdk';
import { MODEL_HAIKU } from '@/lib/models';

const ENTITY_TYPES = ['project', 'person', 'topic', 'account', 'place', 'other'];
const PRIORITIES = ['urgent', 'high', 'normal', 'low'];

// ── Anthropic tool schemas ───────────────────────────────────────────────────
// Exposed to the model in the chat tool loop. Kept here so both the generate
// route and any future surface (Discord bot, companion) share one definition.
export const BRAIN_TOOLS: Anthropic.Tool[] = [
  {
    name: 'create_task',
    description:
      'Create a to-do task for the user. Use when the user asks to remember, add, schedule, or be reminded of something they need to do.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short task title, e.g. "Finish philosophy exam"' },
        due_date: {
          type: 'string',
          description:
            'ISO 8601 date or datetime the task is due (e.g. 2026-06-11 or 2026-06-11T17:00:00Z). Resolve relative dates like "tomorrow" yourself based on the current date.',
        },
        priority: {
          type: 'string',
          enum: PRIORITIES,
          description: 'Task priority. Default normal.',
        },
        notes: { type: 'string', description: 'Optional extra detail about the task.' },
      },
      required: ['title'],
    },
  },
  {
    name: 'list_tasks',
    description:
      "List the user's tasks. Use when they ask what they have to do, what's due, or what's on their plate.",
    input_schema: {
      type: 'object',
      properties: {
        filter: {
          type: 'string',
          enum: ['today', 'urgent', 'all'],
          description:
            "'today' = due today or overdue, 'urgent' = urgent/high priority not done, 'all' = every open task. Default all.",
        },
      },
    },
  },
  {
    name: 'complete_task',
    description: 'Mark a task as done. Identify it by its id or by a fuzzy match on its title.',
    input_schema: {
      type: 'object',
      properties: {
        task_id_or_title: {
          type: 'string',
          description: 'The task id (uuid) or a substring of the task title to match.',
        },
      },
      required: ['task_id_or_title'],
    },
  },
  {
    name: 'search_entities',
    description:
      "Search the user's knowledge base (their projects, people, accounts, topics) for context before answering. Use whenever the user references something specific from their life like 'my TikTok' or a class name.",
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What to search for (name or keyword).' },
      },
      required: ['query'],
    },
  },
  {
    name: 'upsert_entity',
    description:
      'Create or update an entity in the user knowledge base. Use when the user shares a fact about a project, person, account, place, or topic (e.g. "I just hit 15K followers on TikTok"). Matches existing entities by name.',
    input_schema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Entity name, e.g. "TikTok" or "Philosophy of Science".',
        },
        type: {
          type: 'string',
          enum: ENTITY_TYPES,
          description: 'Entity type.',
        },
        summary: { type: 'string', description: '1-2 sentence overview of the entity.' },
        content: {
          type: 'object',
          description:
            'Structured key/value facts to merge in, e.g. { "followers": "15K", "url": "tiktok.com/@me" }.',
        },
        notes: { type: 'string', description: 'Freeform notes to append/replace.' },
      },
      required: ['name', 'type'],
    },
  },
  {
    name: 'rewrite_memory',
    description:
      "Rewrite and clean up the user's global memory (their 'brain'). Use when the user asks you to clean, fix, reorganize, or revamp their brain or memory. The current memory is visible in your system context above. Write a cleaner version that: removes duplicates, fixes wrong or stale facts (especially if the user just corrected one), removes task requests that snuck in, and merges related items. Keep all [from: source] annotations. Format as a plain numbered list — max 20 items.",
    input_schema: {
      type: 'object',
      properties: {
        new_memory: {
          type: 'string',
          description:
            "The cleaned-up memory as a plain numbered list. Example: '1) Works in TypeScript [from: project setup]\\n2) Building Based [from: product pitch]'. Max 20 items.",
        },
      },
      required: ['new_memory'],
    },
  },
];

// ── Task helpers ──────────────────────────────────────────────────────────────
export async function createTask(
  userId: string,
  input: { title: string; due_date?: string; priority?: string; notes?: string }
): Promise<string> {
  const priority = PRIORITIES.includes(input.priority ?? '') ? input.priority : 'normal';
  const { data, error } = await supabaseAdmin
    .from('tasks')
    .insert({
      user_id: userId,
      title: input.title.slice(0, 500),
      due_date: input.due_date ?? null,
      priority,
      notes: input.notes ?? null,
    })
    .select('id, title, due_date, priority')
    .single();
  if (error) return `Could not create task: ${error.message}`;
  const due = data.due_date ? ` (due ${new Date(data.due_date).toLocaleDateString()})` : '';
  return `Created task: "${data.title}"${due} [${data.priority}]`;
}

export async function listTasks(
  userId: string,
  filter: 'today' | 'urgent' | 'all' = 'all'
): Promise<string> {
  let query = supabaseAdmin
    .from('tasks')
    .select('id, title, due_date, priority, status')
    .eq('user_id', userId)
    .in('status', ['todo', 'in_progress'])
    .order('due_date', { ascending: true, nullsFirst: false });

  if (filter === 'today') {
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    query = query.lte('due_date', end.toISOString()).not('due_date', 'is', null);
  } else if (filter === 'urgent') {
    query = query.in('priority', ['urgent', 'high']);
  }

  const { data, error } = await query;
  if (error) return `Could not list tasks: ${error.message}`;
  if (!data || data.length === 0) {
    return filter === 'today'
      ? 'Nothing due today. You are clear.'
      : filter === 'urgent'
        ? 'No urgent tasks.'
        : 'No open tasks.';
  }
  const lines = data.map(t => {
    const due = t.due_date ? ` — due ${new Date(t.due_date).toLocaleDateString()}` : '';
    const pri = t.priority !== 'normal' ? ` [${t.priority}]` : '';
    return `• ${t.title}${due}${pri}`;
  });
  return lines.join('\n');
}

export async function completeTask(userId: string, idOrTitle: string): Promise<string> {
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrTitle);
  let targetId = isUuid ? idOrTitle : null;

  if (!targetId) {
    const { data } = await supabaseAdmin
      .from('tasks')
      .select('id, title')
      .eq('user_id', userId)
      .in('status', ['todo', 'in_progress'])
      .ilike('title', `%${idOrTitle}%`)
      .limit(1);
    if (!data || data.length === 0) return `No open task matching "${idOrTitle}".`;
    targetId = data[0].id;
  }

  const { data, error } = await supabaseAdmin
    .from('tasks')
    .update({ status: 'done', updated_at: new Date().toISOString() })
    .eq('id', targetId)
    .eq('user_id', userId)
    .select('title')
    .single();
  if (error || !data) return `Could not complete that task.`;
  return `Marked done: "${data.title}"`;
}

// ── Entity helpers ────────────────────────────────────────────────────────────
export async function searchEntities(userId: string, query: string): Promise<string> {
  const term = `%${query.trim()}%`;
  const { data, error } = await supabaseAdmin
    .from('entities')
    .select('id, name, type, summary, content, notes')
    .eq('user_id', userId)
    .or(`name.ilike.${term},summary.ilike.${term},notes.ilike.${term}`)
    .order('last_mentioned_at', { ascending: false })
    .limit(3);
  if (error) return `Could not search entities: ${error.message}`;
  if (!data || data.length === 0) return `No entities found matching "${query}".`;
  return data
    .map(e => {
      const content =
        e.content && Object.keys(e.content).length > 0
          ? `\n  facts: ${Object.entries(e.content)
              .map(([k, v]) => `${k}=${v}`)
              .join(', ')}`
          : '';
      const notes = e.notes ? `\n  notes: ${String(e.notes).slice(0, 300)}` : '';
      return `[${e.type}] ${e.name}${e.summary ? ` — ${e.summary}` : ''}${content}${notes}`;
    })
    .join('\n\n');
}

export async function upsertEntity(
  userId: string,
  input: {
    name: string;
    type: string;
    summary?: string;
    content?: Record<string, unknown>;
    notes?: string;
  }
): Promise<string> {
  const type = ENTITY_TYPES.includes(input.type) ? input.type : 'other';
  // Find an existing entity with the same name (case-insensitive) for this user.
  const { data: existing } = await supabaseAdmin
    .from('entities')
    .select('id, content')
    .eq('user_id', userId)
    .ilike('name', input.name.trim())
    .limit(1);

  const now = new Date().toISOString();

  if (existing && existing.length > 0) {
    const mergedContent = {
      ...(existing[0].content ?? {}),
      ...(input.content ?? {}),
    };
    const updates: Record<string, unknown> = {
      type,
      content: mergedContent,
      last_mentioned_at: now,
      updated_at: now,
    };
    if (input.summary) updates.summary = input.summary;
    if (input.notes) updates.notes = input.notes;
    const { error } = await supabaseAdmin
      .from('entities')
      .update(updates)
      .eq('id', existing[0].id)
      .eq('user_id', userId);
    if (error) return `Could not update "${input.name}": ${error.message}`;
    return `Updated entity "${input.name}".`;
  }

  const { error } = await supabaseAdmin.from('entities').insert({
    user_id: userId,
    name: input.name.slice(0, 200),
    type,
    summary: input.summary ?? null,
    content: input.content ?? {},
    notes: input.notes ?? null,
    last_mentioned_at: now,
  });
  if (error) return `Could not create "${input.name}": ${error.message}`;
  return `Created entity "${input.name}" (${type}).`;
}

// ── Tool dispatcher ───────────────────────────────────────────────────────────
// Maps a tool name + input to its handler and returns a plain-text result for
// the model. Unknown tools return an error string rather than throwing.
export async function runBrainTool(
  userId: string,
  name: string,
  input: Record<string, unknown>
): Promise<string> {
  try {
    switch (name) {
      case 'create_task':
        return await createTask(userId, {
          title: String(input.title ?? ''),
          due_date: input.due_date ? String(input.due_date) : undefined,
          priority: input.priority ? String(input.priority) : undefined,
          notes: input.notes ? String(input.notes) : undefined,
        });
      case 'list_tasks':
        return await listTasks(userId, (input.filter as 'today' | 'urgent' | 'all') ?? 'all');
      case 'complete_task':
        return await completeTask(userId, String(input.task_id_or_title ?? ''));
      case 'search_entities':
        return await searchEntities(userId, String(input.query ?? ''));
      case 'upsert_entity':
        return await upsertEntity(userId, {
          name: String(input.name ?? ''),
          type: String(input.type ?? 'other'),
          summary: input.summary ? String(input.summary) : undefined,
          content: (input.content as Record<string, unknown>) ?? undefined,
          notes: input.notes ? String(input.notes) : undefined,
        });
      case 'rewrite_memory':
        return await rewriteMemory(userId, String(input.new_memory ?? ''));
      default:
        return `Unknown tool: ${name}`;
    }
  } catch (err) {
    return `Tool ${name} failed: ${err instanceof Error ? err.message : String(err)}`;
  }
}

// ── Memory rewrite helper ─────────────────────────────────────────────────────
export async function rewriteMemory(userId: string, newMemory: string): Promise<string> {
  const cleaned = newMemory.trim().slice(0, 5000);
  if (!cleaned) return 'No new memory provided — nothing changed.';
  const { error } = await supabaseAdmin
    .from('user_settings')
    .upsert({ user_id: userId, global_memory: cleaned }, { onConflict: 'user_id' });
  if (error) return `Could not save memory: ${error.message}`;
  return 'Brain updated. Your memory has been cleaned up.';
}

// ── Background entity extraction (used by memory route) ───────────────────────
// Runs a Haiku pass over a conversation to identify named entities, then upserts
// each one. Fire-and-forget — failures are swallowed so memory extraction never
// blocks or errors the main flow.
export async function extractAndUpsertEntities(
  userId: string,
  conversation: string
): Promise<void> {
  const apiKey = process.env.APP_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return;
  try {
    const anthropic = new Anthropic({ apiKey });
    const response = await anthropic.messages.create({
      model: MODEL_HAIKU,
      max_tokens: 700,
      messages: [
        {
          role: 'user',
          content: `Identify named entities the user mentioned in this conversation that are worth remembering long-term: their projects, people in their life, social accounts, places, or recurring topics. Ignore generic concepts.

CONVERSATION:
${conversation}

Return ONLY a JSON array (no markdown). Each item:
{"name":"TikTok","type":"account","summary":"User's TikTok account","content":{"followers":"15K"},"notes":""}

type must be one of: project, person, topic, account, place, other.
- Only include entities with a concrete name.
- content holds structured facts as key/value strings (followers, status, url, etc.). Omit or leave {} if none.
- If no notable entities, return [].
Max 6 items.`,
        },
      ],
    });
    const text = response.content[0].type === 'text' ? response.content[0].text : '[]';
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) return;
    const entities = JSON.parse(match[0]) as Array<{
      name?: string;
      type?: string;
      summary?: string;
      content?: Record<string, unknown>;
      notes?: string;
    }>;
    if (!Array.isArray(entities)) return;
    for (const e of entities) {
      if (!e.name || typeof e.name !== 'string') continue;
      await upsertEntity(userId, {
        name: e.name,
        type: e.type ?? 'other',
        summary: e.summary,
        content: e.content,
        notes: e.notes,
      });
    }
  } catch {
    /* fail open — entity extraction is best-effort */
  }
}
