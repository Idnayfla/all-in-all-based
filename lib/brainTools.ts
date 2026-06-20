// Shared server-side helpers for the Tasks + Entity Memory "digital brain".
//
// These run against Supabase with the service-role client and an explicit
// user_id, so they are safe to call from the generate tool loop and the
// background memory extractor alike. They never trust client input for
// ownership — the caller always passes a verified userId.
import { supabaseAdmin } from '@/app/api/_auth';
import Anthropic from '@anthropic-ai/sdk';
import { MODEL_HAIKU } from '@/lib/models';
import { searchImages } from '@/lib/tavily';
import { crawl4aiExtract } from '@/lib/crawl4ai';
import {
  getValidAccessToken,
  checkFreebusy,
  findFreeSlot,
  getCalendarIds,
  createEvent,
  updateEvent,
  deleteEvent,
  deleteEventsByTitle,
  moveEventsByTitle,
  listEventsInRange,
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
    name: 'update_task',
    description:
      'Update an existing task — change its duration, time, date, title, priority, or notes. Also patches the linked Google Calendar event in place so no duplicate is created. Use when the user says "change it to X hours", "make it 2 hours", "update the time to 3pm", "rename it to", "move the task to Tuesday", "set the duration", or any edit to an existing task.',
    input_schema: {
      type: 'object',
      properties: {
        task_id_or_title: {
          type: 'string',
          description: 'The task id (uuid) or a substring of the task title to match.',
        },
        title: { type: 'string', description: 'New title if renaming the task.' },
        due_date: { type: 'string', description: 'New due date in YYYY-MM-DD.' },
        due_time: { type: 'string', description: 'New time in HH:MM 24h.' },
        duration_minutes: { type: 'number', description: 'New duration in minutes.' },
        priority: {
          type: 'string',
          enum: PRIORITIES,
          description: 'New priority.',
        },
        notes: { type: 'string', description: 'New notes.' },
      },
      required: ['task_id_or_title'],
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
    name: 'list_calendar_events',
    description:
      "List all events on the user's Google Calendar for a given date range. Use when the user asks what's on a specific day, or before moving events to identify actual event titles. Returns event names, times, and dates.",
    input_schema: {
      type: 'object',
      properties: {
        date_from: {
          type: 'string',
          description: 'Start date YYYY-MM-DD.',
        },
        date_to: {
          type: 'string',
          description: 'End date YYYY-MM-DD inclusive. Defaults to date_from if omitted.',
        },
      },
      required: ['date_from'],
    },
  },
  {
    name: 'move_calendar_events',
    description:
      'Find Google Calendar events by title and shift their date by N days, shift their time by N hours, OR set an absolute time. Use for "shift X 3 days ahead", "make it 2 hours earlier", "move my lesson to 4pm", "push my meeting back 1 hour", "reschedule VR class to tomorrow". Use shift_hours for relative hour shifts (never guess absolute times when the user says "earlier"/"later"). Works on native calendar events, not just Based tasks.',
    input_schema: {
      type: 'object',
      properties: {
        title_keyword: {
          type: 'string',
          description: 'Keyword matching event titles, e.g. "lesson" or "VR".',
        },
        shift_days: {
          type: 'number',
          description:
            'Days to shift: positive = forward, negative = backward. e.g. 3 = 3 days ahead, -1 = yesterday.',
        },
        shift_hours: {
          type: 'number',
          description:
            "Hours to shift each event: negative = earlier, positive = later. e.g. -2 = 2 hours earlier, 1 = 1 hour later. Applied to each event's existing time, so morning and afternoon sessions both shift correctly with one call.",
        },
        new_time: {
          type: 'string',
          description:
            'New local time in HH:MM 24h. Use when changing only the time, e.g. "16:00".',
        },
        date_from: {
          type: 'string',
          description: 'Only affect events on or after this YYYY-MM-DD. Defaults to today.',
        },
        date_to: {
          type: 'string',
          description:
            'Only affect events on or before this YYYY-MM-DD. Defaults to today + 30 days.',
        },
        confirmed: {
          type: 'boolean',
          description:
            'Set to true to force the move even if destination slots have conflicts. Only use after reporting conflicts to the user and getting explicit confirmation.',
        },
      },
      required: ['title_keyword'],
    },
  },
  {
    name: 'remove_calendar_events',
    description:
      'Search Google Calendar by event title keyword and delete all matching future events. Use when the user asks to remove or delete recurring or native calendar events by name — e.g. "remove all Decompress events", "delete all VR classes from my calendar". Does NOT require a Based task entry.',
    input_schema: {
      type: 'object',
      properties: {
        title_keyword: {
          type: 'string',
          description:
            'Keyword to match against event titles (case-insensitive). e.g. "Decompress".',
        },
        days_ahead: {
          type: 'number',
          description: 'How many days ahead to search and delete. Default 365.',
        },
      },
      required: ['title_keyword'],
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
      'Create or update an entity in the user knowledge base. Use when the user shares a fact about a project, person, account, place, or topic (e.g. "I just hit 15K followers on TikTok"). Call search_entities first to find the exact stored name and use that as the name parameter — this prevents accidental duplicates.',
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
  // ── System control (Electron-only, executed client-side) ──────────────────
  {
    name: 'open_url',
    description:
      "Open a URL in the user's default browser. Use when the user says 'open [site]', 'go to [url]', or 'launch [website]'.",
    input_schema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Full URL to open, e.g. "https://google.com".' },
      },
      required: ['url'],
    },
  },
  {
    name: 'launch_app',
    description:
      "Launch a desktop application. Use when the user says 'open [app]' or 'launch [app]' and it clearly refers to a local app, not a website.",
    input_schema: {
      type: 'object',
      properties: {
        app_name: {
          type: 'string',
          description:
            'App name as it appears in PATH or Start Menu, e.g. "notepad", "spotify", "code".',
        },
      },
      required: ['app_name'],
    },
  },
  {
    name: 'type_text',
    description:
      "Type text into a specific app window. Use when the user says 'type this in Notepad', 'write this in VS Code', 'type for me', etc. Pass target as the app or window name the user mentioned. CRITICAL: 'notepad' or 'the notepad' always means the Windows Notepad desktop app (target='Notepad'), NEVER Google Keep, Notion, or any browser tab — even if you can see those on screen.",
    input_schema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'The exact text to type.' },
        target: {
          type: 'string',
          description:
            "Window title to search for, e.g. 'Notepad', 'Chrome', 'VS Code'. Leave empty to use the front non-Based window. CRITICAL: when user says 'notepad', always pass 'Notepad' here — it means the Windows desktop app, not a browser tab.",
        },
      },
      required: ['text'],
    },
  },
  {
    name: 'write_clipboard',
    description:
      "Write text to the user's clipboard. Use when the user says 'copy this to clipboard' or 'put this in my clipboard'.",
    input_schema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Text to place on the clipboard.' },
      },
      required: ['text'],
    },
  },
  {
    name: 'set_volume',
    description:
      'Set system volume. Use when the user says "set volume to X", "turn it up to X%", "mute" (level 0), or "full volume" (level 100).',
    input_schema: {
      type: 'object',
      properties: {
        level: { type: 'number', description: 'Volume level 0–100.' },
      },
      required: ['level'],
    },
  },
  {
    name: 'search_images',
    description:
      'Search the web for real images and display them inline in chat. ALWAYS call this tool — before writing ANY text — whenever: (1) The user asks to see, show, find, look up, view, or display any image, photo, picture, or visual. (2) The user sends ANY follow-up in a conversation where the assistant previously showed images — this includes single adjectives ("gorier", "scarier", "darker", "funnier"), comparative phrases ("something gorier", "more disturbing", "less scary"), style/genre descriptors ("practical-effects classic", "modern horror", "80s monsters", "black and white"), or filler-padded requests ("gorier bro", "show me more please"). (3) The user says "more", "another", "different", "next", "again" after seeing images. If the previous assistant response contained image markdown (![...]), ALWAYS call this tool for the next user message instead of responding with text. Never describe images in text when you can fetch real ones. Never skip this tool just because the follow-up message is short or informal.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            "What to search images of, e.g. 'golden retriever puppy' or 'Eiffel Tower at night'.",
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'read_url',
    description:
      'Deep-read a URL and return its full text content. Use when the user shares a link and wants to discuss, summarise, or ask questions about the page. Requires CRAWL4AI_URL to be configured — returns null if unavailable.',
    input_schema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The full https URL to read.' },
      },
      required: ['url'],
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

export async function updateTask(
  userId: string,
  input: {
    task_id_or_title: string;
    title?: string;
    due_date?: string;
    due_time?: string;
    duration_minutes?: number;
    priority?: string;
    notes?: string;
  }
): Promise<string> {
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    input.task_id_or_title
  );

  let query = supabaseAdmin
    .from('tasks')
    .select('id, title, due_date, due_time, duration_minutes, priority, notes, google_event_id')
    .eq('user_id', userId)
    .in('status', ['todo', 'in_progress']);
  query = isUuid
    ? query.eq('id', input.task_id_or_title)
    : query.ilike('title', `%${input.task_id_or_title}%`);

  const { data: rows } = await query.limit(1);
  if (!rows || rows.length === 0) return `No matching task found for "${input.task_id_or_title}".`;
  const task = rows[0];

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.title !== undefined) updates.title = input.title.slice(0, 500);
  if (input.due_date !== undefined) updates.due_date = input.due_date;
  if (input.due_time !== undefined) updates.due_time = input.due_time;
  if (input.duration_minutes !== undefined) updates.duration_minutes = input.duration_minutes;
  if (input.priority !== undefined && PRIORITIES.includes(input.priority))
    updates.priority = input.priority;
  if (input.notes !== undefined) updates.notes = input.notes;

  const { data: updated, error } = await supabaseAdmin
    .from('tasks')
    .update(updates)
    .eq('id', task.id)
    .eq('user_id', userId)
    .select('title, due_date, due_time, duration_minutes')
    .single();
  if (error || !updated) return `Could not update task: ${error?.message ?? 'unknown error'}`;

  // Sync to Google Calendar — patch in place, never create a duplicate
  let calResult = '';
  const syncDate = ((input.due_date ?? task.due_date) as string | null) ?? null;
  if (syncDate) {
    try {
      const accessToken = await getValidAccessToken(userId);
      if (!accessToken) {
        calResult = ' (Calendar not connected — task updated without calendar sync.)';
      } else {
        const prefs = await getSchedulingPrefs(userId).catch(() => null);
        const tzOffset = prefs?.timezone ?? '+08:00';
        const calTitle = (input.title ?? task.title) as string;
        const calNotes = (input.notes ?? task.notes) as string | null;
        const calDueTime = ((input.due_time ?? task.due_time) as string | null) ?? null;
        const calDuration =
          ((input.duration_minutes ?? task.duration_minutes) as number | null) ?? null;

        if (task.google_event_id) {
          await updateEvent(
            accessToken,
            task.google_event_id as string,
            calTitle,
            syncDate,
            calNotes,
            {
              dueTime: calDueTime,
              durationMinutes: calDuration,
              tzOffset,
            }
          );
          calResult = ' Google Calendar event updated.';
        } else {
          // No prior calendar event — create one now
          const event = await createEvent(accessToken, calTitle, syncDate, calNotes, {
            dueTime: calDueTime,
            durationMinutes: calDuration,
            tzOffset,
          });
          await supabaseAdmin.from('tasks').update({ google_event_id: event.id }).eq('id', task.id);
          calResult = ' Added to Google Calendar.';
        }
      }
    } catch (e) {
      calResult = ` (Calendar sync failed: ${e instanceof Error ? e.message : String(e)})`;
    }
  }

  const time = updated.due_time ? ` at ${updated.due_time}` : '';
  const dur = updated.duration_minutes ? ` for ${updated.duration_minutes}min` : '';
  return `Updated task: "${updated.title}"${time}${dur}.${calResult}`;
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

export async function removeCalendarEvents(
  userId: string,
  titleKeyword: string,
  daysAhead = 365
): Promise<string> {
  const accessToken = await getValidAccessToken(userId);
  if (!accessToken) return 'Google Calendar not connected — cannot remove events.';
  const { deleted, failed } = await deleteEventsByTitle(accessToken, titleKeyword, daysAhead);
  if (deleted === 0 && failed === 0) return `No upcoming events found matching "${titleKeyword}".`;
  const failNote = failed > 0 ? ` (${failed} could not be deleted)` : '';
  return `Removed ${deleted} event${deleted !== 1 ? 's' : ''} matching "${titleKeyword}" from Google Calendar.${failNote}`;
}

export async function moveCalendarEvents(
  userId: string,
  input: {
    title_keyword: string;
    shift_days?: number;
    shift_hours?: number;
    new_time?: string;
    date_from?: string;
    date_to?: string;
    confirmed?: boolean;
  }
): Promise<string> {
  const accessToken = await getValidAccessToken(userId);
  if (!accessToken) return 'Google Calendar not connected — cannot move events.';
  const prefs = await getSchedulingPrefs(userId).catch(() => null);
  const tzOffset = prefs?.timezone ?? '+08:00';
  try {
    const { moved, failed, conflicts } = await moveEventsByTitle(accessToken, input.title_keyword, {
      shiftDays: input.shift_days,
      shiftHours: input.shift_hours,
      newTime: input.new_time,
      tzOffset,
      dateFrom: input.date_from,
      dateTo: input.date_to,
      checkConflicts: !input.confirmed,
    });
    if (moved === 0 && failed === 0 && conflicts.length === 0)
      return `No events found matching "${input.title_keyword}" in the searched date range. If the events were in the past, call move_calendar_events again with date_from set to cover the original event dates (e.g. 90 days back).`;
    const conflictNote =
      conflicts.length > 0
        ? `\n[CONFLICTS — ${conflicts.length} event(s) NOT moved due to destination conflicts:\n${conflicts.map(c => `  · "${c.title}" → ${c.newStart}`).join('\n')}\nCall move_calendar_events again with confirmed: true to force the move.]`
        : '';
    const action = input.shift_days
      ? `shifted ${input.shift_days > 0 ? input.shift_days + ' day(s) forward' : Math.abs(input.shift_days) + ' day(s) back'}`
      : input.shift_hours
        ? `shifted ${Math.abs(input.shift_hours)} hour(s) ${input.shift_hours < 0 ? 'earlier' : 'later'}`
        : input.new_time
          ? `moved to ${input.new_time}`
          : 'updated';
    const failNote =
      failed > 0
        ? ` (${failed} event${failed !== 1 ? 's' : ''} failed to update — calendar token may need reconnecting)`
        : '';
    const movedNote =
      moved > 0
        ? `${moved} event${moved !== 1 ? 's' : ''} matching "${input.title_keyword}" ${action} in Google Calendar.${failNote}`
        : failed > 0
          ? `FAILED: found ${failed} matching event${failed !== 1 ? 's' : ''} but could not update any. The Google Calendar token may need reconnecting. Tell the user to go to Settings → Google Calendar → Disconnect and reconnect.`
          : '';
    return (
      (movedNote + conflictNote).trim() ||
      `All matching events had conflicts — call move_calendar_events again with confirmed: true to force.`
    );
  } catch (e) {
    return `Failed to move events: ${e instanceof Error ? e.message : String(e)}`;
  }
}

export async function listCalendarEvents(
  userId: string,
  dateFrom: string,
  dateTo?: string
): Promise<string> {
  const accessToken = await getValidAccessToken(userId);
  if (!accessToken) return 'Google Calendar not connected.';
  const to = dateTo ?? dateFrom;
  try {
    const events = await listEventsInRange(accessToken, dateFrom, to);
    if (events.length === 0) return `No events found between ${dateFrom} and ${to}.`;
    // Group by date
    const byDate = new Map<string, typeof events>();
    for (const e of events) {
      const day = e.start.slice(0, 10);
      if (!byDate.has(day)) byDate.set(day, []);
      byDate.get(day)!.push(e);
    }
    const lines: string[] = [];
    for (const [day, dayEvents] of [...byDate.entries()].sort()) {
      const date = new Date(day + 'T00:00:00Z');
      const label = date.toLocaleDateString('en-SG', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        timeZone: 'UTC',
      });
      const evtLines = dayEvents.map(e => {
        if (e.allDay) return `  · ${e.title} (all day)`;
        const s = new Date(e.start).toLocaleTimeString('en-SG', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: true,
          timeZone: 'Asia/Singapore',
        });
        const en = new Date(e.end).toLocaleTimeString('en-SG', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: true,
          timeZone: 'Asia/Singapore',
        });
        return `  · ${e.title} ${s}–${en}`;
      });
      lines.push(`${label}:\n${evtLines.join('\n')}`);
    }
    return lines.join('\n');
  } catch (e) {
    return `Failed to list events: ${e instanceof Error ? e.message : String(e)}`;
  }
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
  const trimmedName = input.name.trim();

  // 1. Try exact case-insensitive match first
  let { data: existing } = await supabaseAdmin
    .from('entities')
    .select('id, content')
    .eq('user_id', userId)
    .ilike('name', trimmedName)
    .limit(1);

  // 2. If no exact match, fall back to partial: stored name contains input or vice-versa.
  //    This catches "TikTok" stored as "TikTok Channel", or vice-versa.
  if (!existing || existing.length === 0) {
    const { data: partial } = await supabaseAdmin
      .from('entities')
      .select('id, content')
      .eq('user_id', userId)
      .or(`name.ilike.%${trimmedName}%,name.ilike.${trimmedName.split(' ')[0]}%`)
      .limit(1);
    if (partial && partial.length > 0) existing = partial;
  }

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
      case 'update_task':
        return await updateTask(userId, {
          task_id_or_title: String(input.task_id_or_title ?? ''),
          title: input.title ? String(input.title) : undefined,
          due_date: input.due_date ? String(input.due_date) : undefined,
          due_time: input.due_time ? String(input.due_time) : undefined,
          duration_minutes:
            typeof input.duration_minutes === 'number' ? input.duration_minutes : undefined,
          priority: input.priority ? String(input.priority) : undefined,
          notes: input.notes ? String(input.notes) : undefined,
        });
      case 'list_tasks':
        return await listTasks(userId, (input.filter as 'today' | 'urgent' | 'all') ?? 'all');
      case 'complete_task':
        return await completeTask(userId, String(input.task_id_or_title ?? ''));
      case 'list_calendar_events':
        return await listCalendarEvents(
          userId,
          String(input.date_from ?? ''),
          input.date_to ? String(input.date_to) : undefined
        );
      case 'move_calendar_events':
        return await moveCalendarEvents(userId, {
          title_keyword: String(input.title_keyword ?? ''),
          shift_days: typeof input.shift_days === 'number' ? input.shift_days : undefined,
          shift_hours: typeof input.shift_hours === 'number' ? input.shift_hours : undefined,
          new_time: input.new_time ? String(input.new_time) : undefined,
          date_from: input.date_from ? String(input.date_from) : undefined,
          date_to: input.date_to ? String(input.date_to) : undefined,
          confirmed: input.confirmed === true,
        });
      case 'cancel_task':
        return await cancelTask(userId, String(input.task_id_or_title ?? ''));
      case 'remove_calendar_events':
        return await removeCalendarEvents(
          userId,
          String(input.title_keyword ?? ''),
          typeof input.days_ahead === 'number' ? input.days_ahead : 365
        );
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
      // System control — execution is deferred to the Electron client.
      // Return a sentinel that the companion route strips out and streams
      // back as a system_actions SSE event for the renderer to execute.
      case 'open_url':
        return `__SYSTEM_ACTION__${JSON.stringify({ action: 'open_url', url: String(input.url ?? '') })}`;
      case 'launch_app':
        return `__SYSTEM_ACTION__${JSON.stringify({ action: 'launch_app', app_name: String(input.app_name ?? '') })}`;
      case 'type_text':
        return `__SYSTEM_ACTION__${JSON.stringify({ action: 'type_text', text: String(input.text ?? ''), target: String(input.target ?? '') })}`;
      case 'write_clipboard':
        return `__SYSTEM_ACTION__${JSON.stringify({ action: 'write_clipboard', text: String(input.text ?? '') })}`;
      case 'set_volume':
        return `__SYSTEM_ACTION__${JSON.stringify({ action: 'set_volume', level: Number(input.level ?? 50) })}`;
      case 'read_url': {
        const content = await crawl4aiExtract(String(input.url ?? ''));
        if (!content) return 'Could not read that URL — crawl4ai may not be configured or the page is unreachable.';
        return `Page content from ${input.url}:\n\n${content}`;
      }
      case 'search_images': {
        const imgs = await searchImages(String(input.query ?? ''), 5);
        if (imgs.length === 0)
          return `No images found for "${input.query}". Try a different search term.`;
        const lines = imgs.map(img => `![${img.title}](${img.url})`).join('\n');
        return `Copy these image lines verbatim into your response so the user sees them inline:\n\n${lines}`;
      }
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
