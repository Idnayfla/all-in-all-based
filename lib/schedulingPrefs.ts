// Scheduling Preferences — stored as an entity (type=topic) in the entities table.
// No imports from brainTools.ts to avoid circular dependency.
import { supabaseAdmin } from '@/app/api/_auth';
import { getValidAccessToken, createEvent } from '@/lib/googleCalendar';

export const PREFS_ENTITY_NAME = 'Scheduling Preferences';

export interface TravelWindow {
  destination: string;
  start: string; // YYYY-MM-DD
  end: string; // YYYY-MM-DD
  confirmed: boolean;
}

export interface SchedulingPrefsContent {
  timezone?: string; // e.g. "+08:00"
  work_hours_start?: string; // "09:00"
  work_hours_end?: string; // "18:00"
  patterns_notes?: string; // freeform learned habits, newline-separated
  slot_accepts?: number; // count of times user accepted a suggested slot
  slot_accepts_last_at?: string; // ISO timestamp
  travel_windows?: TravelWindow[];
}

export async function getSchedulingPrefs(userId: string): Promise<SchedulingPrefsContent | null> {
  const { data } = await supabaseAdmin
    .from('entities')
    .select('content')
    .eq('user_id', userId)
    .ilike('name', PREFS_ENTITY_NAME)
    .limit(1)
    .single();
  if (!data?.content) return null;
  return data.content as SchedulingPrefsContent;
}

export async function getUserTimezone(userId: string): Promise<string> {
  const prefs = await getSchedulingPrefs(userId);
  return prefs?.timezone ?? '+08:00';
}

async function readExistingId(userId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('entities')
    .select('id')
    .eq('user_id', userId)
    .ilike('name', PREFS_ENTITY_NAME)
    .limit(1)
    .single();
  return data?.id ?? null;
}

async function writePrefs(userId: string, content: SchedulingPrefsContent): Promise<void> {
  const now = new Date().toISOString();
  const id = await readExistingId(userId);
  if (id) {
    await supabaseAdmin
      .from('entities')
      .update({
        content: content as Record<string, unknown>,
        last_mentioned_at: now,
        updated_at: now,
      })
      .eq('id', id)
      .eq('user_id', userId);
  } else {
    await supabaseAdmin.from('entities').insert({
      user_id: userId,
      name: PREFS_ENTITY_NAME,
      type: 'topic',
      summary: "User's scheduling preferences, timezone, and availability patterns.",
      content: content as Record<string, unknown>,
      last_mentioned_at: now,
    });
  }
}

// Merges the given fields into the existing prefs. Travel windows are appended
// (not replaced); patterns_note is appended to the existing notes string.
export async function upsertSchedulingPrefs(
  userId: string,
  opts: {
    timezone?: string;
    work_hours_start?: string;
    work_hours_end?: string;
    patterns_note?: string;
    travel_destination?: string;
    travel_start?: string;
    travel_end?: string;
  }
): Promise<string> {
  const existing = await getSchedulingPrefs(userId);
  const content: SchedulingPrefsContent = { ...(existing ?? {}) };

  if (opts.timezone) content.timezone = opts.timezone;
  if (opts.work_hours_start) content.work_hours_start = opts.work_hours_start;
  if (opts.work_hours_end) content.work_hours_end = opts.work_hours_end;

  if (opts.patterns_note) {
    content.patterns_notes = content.patterns_notes
      ? `${content.patterns_notes}\n${opts.patterns_note}`
      : opts.patterns_note;
  }

  let calendarResult = '';
  if (opts.travel_destination && opts.travel_start && opts.travel_end) {
    const win: TravelWindow = {
      destination: opts.travel_destination,
      start: opts.travel_start,
      end: opts.travel_end,
      confirmed: false,
    };
    // Dedup: skip if an identical window already exists
    const alreadyExists = (content.travel_windows ?? []).some(
      w => w.destination === win.destination && w.start === win.start && w.end === win.end
    );
    if (!alreadyExists) {
      content.travel_windows = [...(content.travel_windows ?? []), win];

      // Synchronous calendar sync so errors surface in the tool result
      try {
        const accessToken = await getValidAccessToken(userId);
        if (accessToken) {
          // Google all-day multi-day: end date is exclusive (day after last travel day)
          const endExclusive = new Date(new Date(opts.travel_end).getTime() + 86_400_000)
            .toISOString()
            .slice(0, 10);
          await createEvent(
            accessToken,
            `Travel: ${opts.travel_destination}`,
            opts.travel_start,
            null,
            {
              endDate: endExclusive,
            }
          );
          calendarResult = ` Google Calendar event added (${opts.travel_start} – ${opts.travel_end}).`;
        } else {
          calendarResult = ' (Google Calendar not connected — saved to Brain only.)';
        }
      } catch (e) {
        calendarResult = ` (Calendar sync failed: ${e instanceof Error ? e.message : String(e)})`;
      }
    } else {
      calendarResult = ' (Travel window already saved.)';
    }
  }

  await writePrefs(userId, content);
  return `Scheduling preferences updated.${calendarResult}`;
}

// Records that the user accepted a suggested slot, incrementing the counter
// and appending a note for pattern learning.
export async function recordSlotAccepted(
  userId: string,
  originalTime: string,
  acceptedTime: string,
  date: string
): Promise<void> {
  const existing = await getSchedulingPrefs(userId);
  const content: SchedulingPrefsContent = { ...(existing ?? {}) };
  content.slot_accepts = (content.slot_accepts ?? 0) + 1;
  content.slot_accepts_last_at = new Date().toISOString();
  const note = `Accepted ${acceptedTime} (was ${originalTime}) on ${date}`;
  content.patterns_notes = content.patterns_notes ? `${content.patterns_notes}\n${note}` : note;
  await writePrefs(userId, content);
}
