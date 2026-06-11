// Shared server-side helpers for the Tasks + Entity Memory "digital brain".
//
// These run against Supabase with the service-role client and an explicit
// user_id, so they are safe to call from the generate tool loop and the
// background memory extractor alike. They never trust client input for
// ownership — the caller always passes a verified userId.
import { supabaseAdmin } from '@/app/api/_auth';
import Anthropic from '@anthropic-ai/sdk';
import { MODEL_HAIKU } from '@/lib/models';
import {
  getValidAccessToken,
  checkFreebusy,
  findFreeSlot,
  getCalendarIds,
  createEvent,
  deleteEvent,
} from '@/lib/googleCalendar';
import { getSchedulingPrefs, upsertSchedulingPrefs } from '@/lib/schedulingPrefs';

const ENTITY_TYPES = ['project', 'person', 'topic', 'account', 'place', 'other'];
const PRIORITIES = ['urgent', 'high', 'normal', 'low'];

// ── Anthropic tool schemas ───────────────────────────────────────────────────
// Exposed to the model in the chat tool loop. Kept here so both the generate
// route and any future surface (Discord bot, companion) share one definition.
export const BRAIN_TOOLS: Anthropic.Tool[] = [
  {
    name: 'create_task',
    description:
      'Create a to-do task for the user. Use when the user asks to remember, add, schedule, or be reminded of something they need to do. When due_time is provided, a conflict check runs automatically — if there is a conflict the task will NOT be created and you must report the conflict to the user.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short task title, e.g. "Finish philosophy exam"' },
        due_date: {
          type: 'string',
          description:
            'ISO 8601 date the task is due, e.g. "2026-06-11". Resolve relative dates like "tomorrow" using the current date.',
        },
        due_time: {
          type: 'string',
          description:
            'Local time for the task in HH:MM 24h format, e.g. "14:00". Only set when the user specifies a time.',
        },
        duration_minutes: {
          type: 'number',
          description:
            'How long the task takes in minutes, e.g. 60. Only set when the user specifies a duration.',
        },
        priority: {
          type: 'string',
          enum: PRIORITIES,
          description: 'Task priority. Default normal.',
        },
        notes: { type: 'string', description: 'Optional extra detail about the task.' },
        confirmed_slot: {
          type: 'boolean',
          description:
            'Set to true ONLY when the user has already been shown a conflict and explicitly confirmed the time to use. Skips the automatic conflict check.',
        },
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
    name: 'cancel_task',
    description:
      'Cancel or delete a task and remove its Google Calendar event. Use when the user asks to remove, delete, or cancel a task or meeting. Identify by id or a fuzzy match on title.',
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
  {
    name: 'check_schedule',
    description:
      "Check if a date + time is free on the user's Google Calendar before scheduling a task. Always call this when the user specifies a time. If a conflict is found, report the suggested free slot and ask the user for confirmation before creating the task.",
    input_schema: {
      type: 'object',
      properties: {
        date: {
          type: 'string',
          description: 'Date to check in YYYY-MM-DD format.',
        },
        time: {
          type: 'string',
          description: 'Preferred local time in HH:MM 24h format, e.g. "15:00".',
        },
        duration_minutes: {
          type: 'number',
          description: 'Duration of the task in minutes. Default 60.',
        },
      },
      required: ['date', 'time'],
    },
  },
  {
    name: 'upsert_scheduling_prefs',
    description:
      "Store or update the user's scheduling preferences — timezone, typical work hours, travel windows, or a freeform habit note. Use when the user mentions patterns like 'I'm usually free Tuesday mornings', 'I'll be in Japan May 1-7', or 'I work 9-5'. Always confirm with the user before saving travel windows.",
    input_schema: {
      type: 'object',
      properties: {
        timezone: {
          type: 'string',
          description: 'UTC offset in ±HH:MM format, e.g. "+08:00".',
        },
        work_hours_start: {
          type: 'string',
          description: 'Start of typical work day, HH:MM, e.g. "09:00".',
        },
        work_hours_end: {
          type: 'string',
          description: 'End of typical work day, HH:MM, e.g. "18:00".',
        },
        patterns_note: {
          type: 'string',
          description:
            'A freeform sentence about a scheduling habit to remember, e.g. "Free Tuesday mornings".',
        },
        travel_destination: {
          type: 'string',
          description: 'Destination name for a travel window, e.g. "Japan".',
        },
        travel_start: {
          type: 'string',
          description: 'Start date of travel in YYYY-MM-DD format.',
        },
        travel_end: {
          type: 'string',
          description: 'End date of travel in YYYY-MM-DD format.',
        },
      },
    },
  },
];

// ── Task helpers ──────────────────────────────────────────────────────────────
export async function createTask(
  userId: string,
  input: {
    title: string;
    due_date?: string;
    due_time?: string;
    duration_minutes?: number;
    priority?: string;
    notes?: string;
    confirmed_slot?: boolean;
  }
): Promise<string> {
  // If a time is given without a date, default to today in SGT (UTC+8).
  // Vercel runs UTC — offset manually so "today" is correct for Singapore users.
  const sgtToday = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const effectiveDueDate = input.due_date ?? (input.due_time ? sgtToday : null);

  // Auto conflict check — runs whenever due_time is set and user hasn't already confirmed
  if (effectiveDueDate && input.due_time && !input.confirmed_slot) {
    const conflictMsg = await checkSchedule(
      userId,
      effectiveDueDate,
      input.due_time,
      input.duration_minutes ?? 30
    );
    if (conflictMsg.startsWith('Conflict')) {
      return `[CONFLICT — task NOT created] ${conflictMsg} Ask the user to confirm the suggested time, then call create_task again with that time and confirmed_slot: true.`;
    }
  }

  const priority = PRIORITIES.includes(input.priority ?? '') ? input.priority : 'normal';
  const { data, error } = await supabaseAdmin
    .from('tasks')
    .insert({
      user_id: userId,
      title: input.title.slice(0, 500),
      due_date: effectiveDueDate,
      due_time: input.due_time ?? null,
      duration_minutes: input.duration_minutes ?? null,
      priority,
      notes: input.notes ?? null,
    })
    .select('id, title, due_date, due_time, duration_minutes, priority')
    .single();
  if (error) return `Could not create task: ${error.message}`;

  // Synchronous Google Calendar sync — errors surface in the tool result
  let calResult = '';
  const syncDate = data.due_date ?? effectiveDueDate;
  if (syncDate) {
    try {
      const accessToken = await getValidAccessToken(userId);
      if (!accessToken) {
        calResult = ' (Google Calendar not connected — task saved without calendar event.)';
      } else {
        const prefs = await getSchedulingPrefs(userId).catch(() => null);
        const tzOffset = prefs?.timezone ?? '+08:00';
        const event = await createEvent(accessToken, data.title, syncDate, input.notes ?? null, {
          dueTime: data.due_time ?? null,
          durationMinutes: data.duration_minutes ?? null,
          tzOffset,
        });
        await supabaseAdmin.from('tasks').update({ google_event_id: event.id }).eq('id', data.id);
        calResult = ' Added to Google Calendar.';
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('403')) {
        calResult =
          ' (Calendar sync failed: Google Calendar needs to be reconnected — the stored token is missing write permission. Tell the user to go to Settings → Google Calendar → Disconnect and reconnect.)';
      } else {
        calResult = ` (Calendar sync failed: ${msg})`;
      }
    }
  }

  const due = data.due_date ? ` (due ${new Date(data.due_date).toLocaleDateString()})` : '';
  const time = data.due_time ? ` at ${data.due_time}` : '';
  const dur = data.duration_minutes ? ` for ${data.duration_minutes}min` : '';
  return `Created task: "${data.title}"${due}${time}${dur} [${data.priority}]${calResult}`;
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

export async function cancelTask(userId: string, idOrTitle: string): Promise<string> {
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrTitle);

  let query = supabaseAdmin
    .from('tasks')
    .select('id, title, google_event_id')
    .eq('user_id', userId);
  query = isUuid ? query.eq('id', idOrTitle) : query.ilike('title', `%${idOrTitle}%`);

  const { data: rows } = await query.limit(1);
  if (!rows || rows.length === 0) return `No matching task found for: ${idOrTitle}`;
  const task = rows[0];

  let calMsg = ' (No calendar event linked.)';
  if (task.google_event_id) {
    try {
      const accessToken = await getValidAccessToken(userId);
      if (!accessToken) {
        calMsg = ' (Calendar event removal failed: Google Calendar not connected.)';
      } else {
        await deleteEvent(accessToken, task.google_event_id);
        calMsg = ' and removed from Google Calendar.';
      }
    } catch (e) {
      calMsg = ` (Calendar event removal failed: ${e instanceof Error ? e.message : String(e)})`;
    }
  }

  await supabaseAdmin.from('tasks').delete().eq('id', task.id).eq('user_id', userId);

  if (calMsg === ' and removed from Google Calendar.') {
    return `Cancelled task: "${task.title}"${calMsg}`;
  }
  return `Cancelled task: "${task.title}".${calMsg}`;
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
          due_time: input.due_time ? String(input.due_time) : undefined,
          duration_minutes:
            typeof input.duration_minutes === 'number' ? input.duration_minutes : undefined,
          priority: input.priority ? String(input.priority) : undefined,
          notes: input.notes ? String(input.notes) : undefined,
          confirmed_slot: input.confirmed_slot === true,
        });
      case 'list_tasks':
        return await listTasks(userId, (input.filter as 'today' | 'urgent' | 'all') ?? 'all');
      case 'complete_task':
        return await completeTask(userId, String(input.task_id_or_title ?? ''));
      case 'cancel_task':
        return await cancelTask(userId, String(input.task_id_or_title ?? ''));
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
      case 'check_schedule':
        return await checkSchedule(
          userId,
          String(input.date ?? ''),
          String(input.time ?? ''),
          typeof input.duration_minutes === 'number' ? input.duration_minutes : 60
        );
      case 'upsert_scheduling_prefs':
        return await upsertSchedulingPrefs(userId, {
          timezone: input.timezone ? String(input.timezone) : undefined,
          work_hours_start: input.work_hours_start ? String(input.work_hours_start) : undefined,
          work_hours_end: input.work_hours_end ? String(input.work_hours_end) : undefined,
          patterns_note: input.patterns_note ? String(input.patterns_note) : undefined,
          travel_destination: input.travel_destination
            ? String(input.travel_destination)
            : undefined,
          travel_start: input.travel_start ? String(input.travel_start) : undefined,
          travel_end: input.travel_end ? String(input.travel_end) : undefined,
        });
      default:
        return `Unknown tool: ${name}`;
    }
  } catch (err) {
    return `Tool ${name} failed: ${err instanceof Error ? err.message : String(err)}`;
  }
}

// ── Scheduling helpers ────────────────────────────────────────────────────────
async function checkSchedule(
  userId: string,
  date: string,
  time: string,
  durationMinutes: number
): Promise<string> {
  if (!date || !time) return 'Date and time are required to check the schedule.';
  const accessToken = await getValidAccessToken(userId);
  if (!accessToken) return 'Calendar not connected — proceeding without conflict check.';

  const prefs = await getSchedulingPrefs(userId);
  const tzOffset = prefs?.timezone ?? '+08:00';

  // Alert if date falls within a known travel window
  if (prefs?.travel_windows) {
    for (const w of prefs.travel_windows) {
      if (date >= w.start && date <= w.end) {
        return `Note: you have a travel window to ${w.destination} (${w.start}–${w.end}) covering this date. Are you still available?`;
      }
    }
  }

  const calIds = await getCalendarIds(accessToken);
  const busySlots = await checkFreebusy(accessToken, date, tzOffset, calIds);
  const result = findFreeSlot(busySlots, date, time, durationMinutes, tzOffset);

  if (!result.conflict) return `${time} is free on ${date}.`;
  if (result.suggested) {
    return `Conflict at ${time} on ${date} — next free slot: ${result.suggested}. Want me to schedule it at ${result.suggested} instead?`;
  }
  return `Conflict at ${time} on ${date} — no free slot found for the rest of the day.`;
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
