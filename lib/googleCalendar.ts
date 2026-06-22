import { supabaseAdmin } from '@/app/api/_auth';

const OAUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const CAL_BASE = 'https://www.googleapis.com/calendar/v3/calendars';
const CAL_LIST_URL = 'https://www.googleapis.com/calendar/v3/users/me/calendarList';
const FREEBUSY_URL = 'https://www.googleapis.com/calendar/v3/freeBusy';
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';
// calendar.readonly lets us list all calendars; calendar.events lets us create events
const SCOPE = [
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/calendar.events',
].join(' ');

export interface CalTokens {
  access_token: string;
  refresh_token: string;
  expiry: number;
  email: string;
}

export interface CalEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  url: string;
  allDay: boolean;
}

// Temporary debug payload surfaced via the events API so failures are visible
// in the browser Network tab instead of being silently swallowed.
export interface CalDebugInfo {
  calendarListStatus: number | string;
  calendarListError?: string;
  calendarsFound: number;
  calendarIds: string[];
  perCalendar: Array<{ id: string; status: number | string; count: number; error?: string }>;
  totalEvents: number;
}

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? 'https://getbased.dev';
}

export function getRedirectUri(): string {
  return `${appUrl()}/api/calendar/callback`;
}

export function buildAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: getRedirectUri(),
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline',
    // select_account forces the chooser (so the in-app browser's existing Google
    // session doesn't silently pick an account); consent ensures a refresh token.
    prompt: 'select_account consent',
    state,
  });
  return `${OAUTH_URL}?${params.toString()}`;
}

export async function exchangeCode(
  code: string
): Promise<{ access_token: string; refresh_token: string; expires_in: number }> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: getRedirectUri(),
      grant_type: 'authorization_code',
    }).toString(),
  });
  if (!res.ok) throw new Error(`Token exchange failed: ${await res.text()}`);
  return res.json();
}

async function refreshTokens(
  refreshToken: string
): Promise<{ access_token: string; expires_in: number }> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      grant_type: 'refresh_token',
    }).toString(),
  });
  if (!res.ok) throw new Error(`Token refresh failed: ${await res.text()}`);
  return res.json();
}

export async function getUserEmail(accessToken: string): Promise<string> {
  const res = await fetch(USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return '';
  const data = await res.json();
  return (data as { email?: string }).email ?? '';
}

export async function getTokensForUser(userId: string): Promise<CalTokens | null> {
  const { data } = await supabaseAdmin
    .from('user_settings')
    .select('google_calendar_tokens')
    .eq('user_id', userId)
    .single();
  const tokens = data?.google_calendar_tokens as CalTokens | null | undefined;
  return tokens ?? null;
}

export async function saveTokensForUser(userId: string, tokens: CalTokens): Promise<void> {
  await supabaseAdmin
    .from('user_settings')
    .upsert({ user_id: userId, google_calendar_tokens: tokens }, { onConflict: 'user_id' });
}

export async function deleteTokensForUser(userId: string): Promise<void> {
  await supabaseAdmin
    .from('user_settings')
    .upsert({ user_id: userId, google_calendar_tokens: null }, { onConflict: 'user_id' });
}

export async function getValidAccessToken(userId: string): Promise<string | null> {
  const tokens = await getTokensForUser(userId);
  if (!tokens) return null;
  if (tokens.expiry > Date.now() + 60_000) return tokens.access_token;
  try {
    const refreshed = await refreshTokens(tokens.refresh_token);
    const updated: CalTokens = {
      ...tokens,
      access_token: refreshed.access_token,
      expiry: Date.now() + refreshed.expires_in * 1000,
    };
    await saveTokensForUser(userId, updated);
    return updated.access_token;
  } catch {
    return null;
  }
}

export async function getCalendarIds(accessToken: string): Promise<string[]> {
  const result = await listCalendarIds(accessToken);
  return result.ids;
}

async function listCalendarIds(
  accessToken: string
): Promise<{ ids: string[]; status: number | string; error?: string }> {
  try {
    const res = await fetch(`${CAL_LIST_URL}?maxResults=25`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      // Old tokens may lack calendar.readonly — fall back to the primary calendar,
      // but keep the status + error body so we can see WHY it failed.
      const body = (await res.text()).slice(0, 300);
      return { ids: ['primary'], status: res.status, error: body };
    }
    const data = (await res.json()) as { items?: Array<{ id: string }> };
    const ids = (data.items ?? []).map(item => item.id).filter(Boolean);
    return { ids: ids.length > 0 ? ids : ['primary'], status: res.status };
  } catch (e) {
    return {
      ids: ['primary'],
      status: 'fetch-failed',
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

async function listEventsForCalendar(
  accessToken: string,
  calendarId: string,
  timeMin: string,
  timeMax: string
): Promise<{ events: CalEvent[]; status: number | string; error?: string }> {
  const params = new URLSearchParams({
    timeMin,
    timeMax,
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '50',
  });
  try {
    const res = await fetch(
      `${CAL_BASE}/${encodeURIComponent(calendarId)}/events?${params.toString()}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!res.ok) {
      const body = (await res.text()).slice(0, 300);
      return { events: [], status: res.status, error: body };
    }
    const data = (await res.json()) as {
      items?: Array<{
        id: string;
        summary?: string;
        start: { dateTime?: string; date?: string };
        end: { dateTime?: string; date?: string };
        htmlLink?: string;
      }>;
    };
    const events = (data.items ?? []).map(item => ({
      id: item.id,
      title: item.summary ?? '(no title)',
      start: item.start.dateTime ?? item.start.date ?? '',
      end: item.end.dateTime ?? item.end.date ?? '',
      url: item.htmlLink ?? '',
      allDay: !item.start.dateTime,
    }));
    return { events, status: res.status };
  } catch (e) {
    return {
      events: [],
      status: 'fetch-failed',
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export async function listEvents(
  accessToken: string,
  days = 30
): Promise<{ events: CalEvent[]; debug: CalDebugInfo }> {
  // Start from midnight today so events earlier today still show up
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const timeMin = start.toISOString();
  const timeMax = new Date(Date.now() + days * 86_400_000).toISOString();
  const calList = await listCalendarIds(accessToken);
  const calendarIds = calList.ids.slice(0, 10);
  const results = await Promise.all(
    calendarIds.map(id => listEventsForCalendar(accessToken, id, timeMin, timeMax))
  );
  // Dedupe by event id — the same event can appear in multiple calendars
  const seen = new Set<string>();
  const events: CalEvent[] = [];
  for (const event of results.flatMap(r => r.events)) {
    if (seen.has(event.id)) continue;
    seen.add(event.id);
    events.push(event);
  }
  events.sort((a, b) => a.start.localeCompare(b.start));
  const debug: CalDebugInfo = {
    calendarListStatus: calList.status,
    ...(calList.error ? { calendarListError: calList.error } : {}),
    calendarsFound: calList.ids.length,
    calendarIds: calendarIds.slice(0, 5),
    perCalendar: calendarIds.map((id, i) => ({
      id,
      status: results[i].status,
      count: results[i].events.length,
      ...(results[i].error ? { error: results[i].error } : {}),
    })),
    totalEvents: events.length,
  };
  return { events, debug };
}

// ── Freebusy + slot finder ────────────────────────────────────────────────────

// Convert a UTC Date to local HH:MM using a UTC offset string like "+08:00"
function utcToLocalTime(date: Date, tzOffset: string): string {
  const sign = tzOffset.startsWith('-') ? -1 : 1;
  const parts = tzOffset.slice(1).split(':');
  const offsetMs = sign * (Number(parts[0]) * 60 + Number(parts[1])) * 60_000;
  const local = new Date(date.getTime() + offsetMs);
  return `${String(local.getUTCHours()).padStart(2, '0')}:${String(local.getUTCMinutes()).padStart(2, '0')}`;
}

export async function checkFreebusy(
  accessToken: string,
  date: string, // YYYY-MM-DD
  tzOffset: string, // e.g. "+08:00"
  calendarIds: string[]
): Promise<Array<{ start: string; end: string }>> {
  const timeMin = `${date}T00:00:00${tzOffset}`;
  const timeMax = `${date}T23:59:59${tzOffset}`;
  try {
    const res = await fetch(FREEBUSY_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ timeMin, timeMax, items: calendarIds.map(id => ({ id })) }),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      calendars?: Record<string, { busy?: Array<{ start: string; end: string }> }>;
    };
    const all: Array<{ start: string; end: string }> = [];
    for (const cal of Object.values(data.calendars ?? {})) {
      all.push(...(cal.busy ?? []));
    }
    return all;
  } catch {
    return [];
  }
}

export function findFreeSlot(
  busySlots: Array<{ start: string; end: string }>,
  date: string,
  preferredTime: string, // HH:MM local
  durationMinutes: number,
  tzOffset: string
): { time: string; conflict: boolean; suggested?: string } {
  const ms = (iso: string) => new Date(iso).getTime();
  const durMs = durationMinutes * 60_000;
  const prefStart = ms(`${date}T${preferredTime}:00${tzOffset}`);
  const prefEnd = prefStart + durMs;
  const dayStart = ms(`${date}T08:00:00${tzOffset}`);
  const dayEnd = ms(`${date}T22:00:00${tzOffset}`);

  // Merge overlapping busy slots
  const sorted = busySlots.map(b => ({ s: ms(b.start), e: ms(b.end) })).sort((a, b) => a.s - b.s);
  const merged: Array<{ s: number; e: number }> = [];
  for (const slot of sorted) {
    if (merged.length && slot.s <= merged[merged.length - 1].e) {
      merged[merged.length - 1].e = Math.max(merged[merged.length - 1].e, slot.e);
    } else {
      merged.push({ ...slot });
    }
  }

  const overlaps = (s: number, e: number) => merged.some(b => b.s < e && b.e > s);

  if (!overlaps(prefStart, prefEnd)) return { time: preferredTime, conflict: false };

  // Walk forward from preferred time to find the next free gap
  let candidate = Math.max(dayStart, prefStart);
  for (let i = 0; i < 100; i++) {
    const end = candidate + durMs;
    if (end > dayEnd) break;
    const hit = merged.find(b => b.s < end && b.e > candidate);
    if (!hit) {
      return {
        time: preferredTime,
        conflict: true,
        suggested: utcToLocalTime(new Date(candidate), tzOffset),
      };
    }
    candidate = hit.e;
  }

  return { time: preferredTime, conflict: true }; // no slot found today
}

// ── Event CRUD ────────────────────────────────────────────────────────────────

interface EventTimeOpts {
  dueTime?: string | null; // HH:MM local
  durationMinutes?: number | null;
  tzOffset?: string | null; // "+08:00"
  endDate?: string | null; // YYYY-MM-DD exclusive end for multi-day all-day events
}

function buildEventTimes(
  dateOnly: string,
  opts?: EventTimeOpts
): { start: Record<string, string>; end: Record<string, string> } {
  if (opts?.dueTime && opts.tzOffset) {
    const duration = opts.durationMinutes && opts.durationMinutes > 0 ? opts.durationMinutes : 60;
    const startDt = `${dateOnly}T${opts.dueTime}:00${opts.tzOffset}`;
    const endMs = new Date(startDt).getTime() + duration * 60_000;
    return {
      start: { dateTime: startDt },
      end: { dateTime: new Date(endMs).toISOString() },
    };
  }
  if (opts?.endDate) {
    return { start: { date: dateOnly }, end: { date: opts.endDate } };
  }
  return { start: { date: dateOnly }, end: { date: dateOnly } };
}

export async function createEvent(
  accessToken: string,
  title: string,
  dueDate: string,
  notes?: string | null,
  opts?: EventTimeOpts
): Promise<{ id: string; url: string }> {
  const times = buildEventTimes(dueDate.slice(0, 10), opts);
  const res = await fetch(CAL_BASE + '/primary/events', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ summary: title, description: notes ?? '', ...times }),
  });
  if (!res.ok) throw new Error(`Create event failed: ${res.status}`);
  const data = (await res.json()) as { id: string; htmlLink: string };
  return { id: data.id, url: data.htmlLink };
}

export async function updateEvent(
  accessToken: string,
  eventId: string,
  title: string,
  dueDate: string,
  notes?: string | null,
  opts?: EventTimeOpts
): Promise<void> {
  const times = buildEventTimes(dueDate.slice(0, 10), opts);
  const res = await fetch(`${CAL_BASE}/primary/events/${encodeURIComponent(eventId)}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ summary: title, description: notes ?? '', ...times }),
  });
  if (!res.ok) throw new Error(`Update event failed: ${res.status}`);
}

export async function listEventsInRange(
  accessToken: string,
  dateFrom: string, // YYYY-MM-DD
  dateTo: string // YYYY-MM-DD inclusive
): Promise<CalEvent[]> {
  const timeMin = `${dateFrom}T00:00:00Z`;
  const timeMax = `${dateTo}T23:59:59Z`;
  const calIds = await getCalendarIds(accessToken);
  const results = await Promise.all(
    calIds.map(async calId => {
      const params = new URLSearchParams({
        timeMin,
        timeMax,
        singleEvents: 'true',
        orderBy: 'startTime',
        maxResults: '250',
      });
      try {
        const res = await fetch(`${CAL_BASE}/${encodeURIComponent(calId)}/events?${params}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!res.ok) return [] as CalEvent[];
        const data = (await res.json()) as {
          items?: Array<{
            id: string;
            summary?: string;
            start: { dateTime?: string; date?: string };
            end: { dateTime?: string; date?: string };
            htmlLink?: string;
          }>;
        };
        return (data.items ?? []).map(item => ({
          id: item.id,
          title: item.summary ?? '(no title)',
          start: item.start.dateTime ?? item.start.date ?? '',
          end: item.end.dateTime ?? item.end.date ?? '',
          url: item.htmlLink ?? '',
          allDay: !item.start.dateTime,
        }));
      } catch {
        return [] as CalEvent[];
      }
    })
  );
  // Dedupe by event id
  const seen = new Set<string>();
  const events: CalEvent[] = [];
  for (const e of results.flat()) {
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    events.push(e);
  }
  events.sort((a, b) => a.start.localeCompare(b.start));
  return events;
}

export async function moveEventsByTitle(
  accessToken: string,
  titleKeyword: string,
  opts: {
    shiftDays?: number; // +ve = forward, -ve = backward
    shiftHours?: number; // +ve = later, -ve = earlier — applied to each event's existing time
    newTime?: string; // HH:MM 24h local — change time, keep date
    tzOffset?: string; // e.g. "+08:00"
    dateFrom?: string; // YYYY-MM-DD, default today
    dateTo?: string; // YYYY-MM-DD, default today+30
    checkConflicts?: boolean; // skip moves whose destination slot is busy
  }
): Promise<{
  moved: number;
  failed: number;
  conflicts: Array<{ title: string; newStart: string }>;
}> {
  // Default to 90 days back so past events are found when date_from is not specified
  const timeMin = opts.dateFrom
    ? `${opts.dateFrom}T00:00:00Z`
    : new Date(Date.now() - 90 * 86_400_000).toISOString();
  const timeMax = opts.dateTo
    ? `${opts.dateTo}T23:59:59Z`
    : new Date(Date.now() + 30 * 86_400_000).toISOString();

  const calIds = await getCalendarIds(accessToken);

  type FoundEvent = {
    id: string;
    calendarId: string;
    summary?: string;
    description?: string;
    start: { dateTime?: string; date?: string };
    end: { dateTime?: string; date?: string };
  };

  // Search all calendars
  const allItems: FoundEvent[] = [];
  for (const calId of calIds) {
    const params = new URLSearchParams({
      timeMin,
      timeMax,
      singleEvents: 'true',
      maxResults: '500',
      q: titleKeyword,
    });
    try {
      const res = await fetch(`${CAL_BASE}/${encodeURIComponent(calId)}/events?${params}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) continue;
      const data = (await res.json()) as { items?: FoundEvent[] };
      for (const item of data.items ?? []) {
        if (item.summary?.toLowerCase().includes(titleKeyword.toLowerCase())) {
          allItems.push({ ...item, calendarId: calId });
        }
      }
    } catch {
      continue;
    }
  }

  // Dedupe by id
  const seen = new Set<string>();
  const items = allItems.filter(e => {
    if (seen.has(e.id)) return false;
    seen.add(e.id);
    return true;
  });

  let moved = 0;
  let failed = 0;
  const conflicts: Array<{ title: string; newStart: string }> = [];

  const tzOffset = opts.tzOffset ?? '+08:00';

  for (const item of items) {
    try {
      let newStart: Record<string, string>;
      let newEnd: Record<string, string>;

      if (item.start.dateTime) {
        const startMs = new Date(item.start.dateTime).getTime();
        const endMs = new Date(item.end.dateTime!).getTime();
        const duration = endMs - startMs;
        let newStartMs =
          startMs + (opts.shiftDays ?? 0) * 86_400_000 + (opts.shiftHours ?? 0) * 3_600_000;
        if (opts.newTime) {
          const dateStr = new Date(newStartMs).toISOString().slice(0, 10);
          newStartMs = new Date(`${dateStr}T${opts.newTime}:00${tzOffset}`).getTime();
        }

        // Conflict check
        if (opts.checkConflicts) {
          const destDate = new Date(newStartMs).toISOString().slice(0, 10);
          const destTimeLocal = utcToLocalTime(new Date(newStartMs), tzOffset);
          const durationMin = Math.round(duration / 60_000);
          const busySlots = await checkFreebusy(accessToken, destDate, tzOffset, calIds);
          // Exclude the event's own current slot from busy check
          const filteredBusy = busySlots.filter(b => {
            const bStart = new Date(b.start).getTime();
            const bEnd = new Date(b.end).getTime();
            return !(bStart === startMs && bEnd === startMs + duration);
          });
          const result = findFreeSlot(filteredBusy, destDate, destTimeLocal, durationMin, tzOffset);
          if (result.conflict) {
            conflicts.push({
              title: item.summary ?? '(no title)',
              newStart: `${destDate} ${destTimeLocal}`,
            });
            continue;
          }
        }

        newStart = { dateTime: new Date(newStartMs).toISOString() };
        newEnd = { dateTime: new Date(newStartMs + duration).toISOString() };
      } else {
        const shiftMs = (opts.shiftDays ?? 0) * 86_400_000;
        const newSD = new Date(new Date(item.start.date! + 'T00:00:00Z').getTime() + shiftMs);
        const newED = new Date(new Date(item.end.date! + 'T00:00:00Z').getTime() + shiftMs);
        newStart = { date: newSD.toISOString().slice(0, 10) };
        newEnd = { date: newED.toISOString().slice(0, 10) };
      }

      // PATCH using the calendar where the event was found
      const patchRes = await fetch(
        `${CAL_BASE}/${encodeURIComponent(item.calendarId)}/events/${encodeURIComponent(item.id)}`,
        {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            summary: item.summary,
            description: item.description ?? '',
            start: newStart,
            end: newEnd,
          }),
        }
      );
      if (!patchRes.ok) {
        const errBody = (await patchRes.text()).slice(0, 200);
        throw new Error(`Patch failed ${patchRes.status}: ${errBody}`);
      }
      moved++;
    } catch {
      failed++;
    }
  }

  return { moved, failed, conflicts };
}

export async function deleteEventsByTitle(
  accessToken: string,
  titleKeyword: string,
  days = 365
): Promise<{ deleted: number; failed: number }> {
  const timeMin = new Date().toISOString();
  const timeMax = new Date(Date.now() + days * 86_400_000).toISOString();
  const calIds = await getCalendarIds(accessToken);

  type FoundEvent = { id: string; calendarId: string; summary?: string };
  const allItems: FoundEvent[] = [];

  for (const calId of calIds) {
    const params = new URLSearchParams({
      timeMin,
      timeMax,
      singleEvents: 'true',
      maxResults: '2500',
      q: titleKeyword,
    });
    try {
      const res = await fetch(`${CAL_BASE}/${encodeURIComponent(calId)}/events?${params}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) continue;
      const data = (await res.json()) as { items?: FoundEvent[] };
      for (const item of data.items ?? []) {
        if (item.summary?.toLowerCase().includes(titleKeyword.toLowerCase())) {
          allItems.push({ ...item, calendarId: calId });
        }
      }
    } catch {
      continue;
    }
  }

  // Dedupe
  const seen = new Set<string>();
  const items = allItems.filter(e => {
    if (seen.has(e.id)) return false;
    seen.add(e.id);
    return true;
  });

  let deleted = 0;
  let failed = 0;
  for (const item of items) {
    try {
      await deleteEvent(accessToken, item.id, item.calendarId);
      deleted++;
    } catch {
      failed++;
    }
  }
  return { deleted, failed };
}

export async function deleteEvent(
  accessToken: string,
  eventId: string,
  calendarId = 'primary'
): Promise<void> {
  const res = await fetch(
    `${CAL_BASE}/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );
  if (!res.ok && res.status !== 404 && res.status !== 410) {
    throw new Error(`Delete event failed: ${res.status}`);
  }
}
