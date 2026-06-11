import { supabaseAdmin } from '@/app/api/_auth';

const OAUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const EVENTS_BASE = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';
const SCOPE = 'https://www.googleapis.com/auth/calendar.events';

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
    prompt: 'consent',
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

export async function listEvents(accessToken: string, days = 30): Promise<CalEvent[]> {
  const timeMin = new Date().toISOString();
  const timeMax = new Date(Date.now() + days * 86_400_000).toISOString();
  const params = new URLSearchParams({
    timeMin,
    timeMax,
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '50',
  });
  const res = await fetch(`${EVENTS_BASE}?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`List events failed: ${res.status}`);
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
}

export async function createEvent(
  accessToken: string,
  title: string,
  dueDate: string,
  notes?: string | null
): Promise<{ id: string; url: string }> {
  const dateOnly = dueDate.slice(0, 10);
  const body = {
    summary: title,
    description: notes ?? '',
    start: { date: dateOnly },
    end: { date: dateOnly },
  };
  const res = await fetch(EVENTS_BASE, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Create event failed: ${res.status}`);
  const data = (await res.json()) as { id: string; htmlLink: string };
  return { id: data.id, url: data.htmlLink };
}
