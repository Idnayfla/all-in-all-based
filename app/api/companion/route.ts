import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getUserId, supabaseAdmin } from '../_auth';
import { getUserIdFromApiKey, ApiRateLimitError } from '../_apiKeyAuth';
import { getWeather } from '@/lib/weather';
import { getTrafficInfo } from '@/lib/traffic';
import { exaSearch } from '@/lib/tavily';
import { MODEL_SONNET, MODEL_HAIKU } from '@/lib/models';

export const maxDuration = 60;
// Screenshots sent from the desktop companion can be several MB as base64.
// Raise the per-route body size limit to 20 MB so they are not rejected.
export const maxBodySize = '20mb';

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || process.env.APP_ANTHROPIC_API_KEY,
});

// Required Supabase migration (run once in dashboard):
// create table if not exists companion_usage (
//   id uuid default gen_random_uuid() primary key,
//   user_id uuid not null references auth.users(id) on delete cascade,
//   created_at timestamptz default now() not null
// );
// create index on companion_usage (user_id, created_at);
//
// Session tracking columns (added via upsert â€” Supabase auto-creates on first write):
// companion_session_count  int  default 0
// companion_last_seen      timestamptz
// companion_first_seen     timestamptz
// companion_patterns_surfaced  boolean  default false

const FREE_DAILY_LIMIT = 5;

async function getEffectiveTier(userId: string): Promise<'free' | 'pro'> {
  const { data } = await supabaseAdmin
    .from('user_settings')
    .select('subscription_tier, subscription_status, pro_bonus_expires_at')
    .eq('user_id', userId)
    .single();
  const paidTier = (data?.subscription_tier ?? 'free') as 'free' | 'pro';
  const subStatus = data?.subscription_status ?? 'active';
  const isCanceled = subStatus === 'canceled' || subStatus === 'cancelled';
  const bonusExpiresAt = data?.pro_bonus_expires_at as string | null;
  const hasBonusPro = !!bonusExpiresAt && new Date(bonusExpiresAt) > new Date();
  const alwaysPro = process.env.ALWAYS_PRO === 'true' || !!process.env.BETA_ACCESS_CODE;
  return alwaysPro || (paidTier === 'pro' && !isCanceled) || hasBonusPro ? 'pro' : 'free';
}

// Fire-and-forget: mark companion_weather_last_surfaced = now
function markWeatherSurfacedAsync(userId: string): void {
  void (async () => {
    try {
      await supabaseAdmin
        .from('user_settings')
        .upsert(
          { user_id: userId, companion_weather_last_surfaced: new Date().toISOString() },
          { onConflict: 'user_id' }
        );
    } catch {
      // silent â€” column may not exist yet
    }
  })();
}

// Fire-and-forget: increment session count + update last_seen/first_seen in user_settings.
// Returns the updated session count (or null on failure).
async function trackCompanionSession(userId: string): Promise<{
  sessionCount: number;
  firstSeen: string | null;
  patternsSurfaced: boolean;
  weatherLastSurfaced: string | null;
} | null> {
  try {
    // Read current values
    const { data: current } = await supabaseAdmin
      .from('user_settings')
      .select(
        'companion_session_count, companion_first_seen, companion_patterns_surfaced, companion_weather_last_surfaced'
      )
      .eq('user_id', userId)
      .single();

    const now = new Date().toISOString();
    const prevCount = (current?.companion_session_count as number | null) ?? 0;
    const firstSeen = (current?.companion_first_seen as string | null) ?? now;
    const patternsSurfaced = (current?.companion_patterns_surfaced as boolean | null) ?? false;
    const weatherLastSurfaced = (current?.companion_weather_last_surfaced as string | null) ?? null;
    const newCount = prevCount + 1;

    await supabaseAdmin.from('user_settings').upsert(
      {
        user_id: userId,
        companion_session_count: newCount,
        companion_last_seen: now,
        // Only set first_seen if it was null
        ...(current?.companion_first_seen ? {} : { companion_first_seen: now }),
      },
      { onConflict: 'user_id' }
    );

    return { sessionCount: newCount, firstSeen, patternsSurfaced, weatherLastSurfaced };
  } catch {
    // Columns may not exist yet â€” silently ignore
    return null;
  }
}

// Fire-and-forget: extract patterns from the last 10 messages and append to global_memory.
function extractPatternsAsync(
  userId: string,
  messages: Array<{ role: string; content: string }>
): void {
  void (async () => {
    try {
      const last10 = messages.slice(-10);
      const { data: settingsData } = await supabaseAdmin
        .from('user_settings')
        .select('global_memory')
        .eq('user_id', userId)
        .single();
      const existing = (settingsData?.global_memory as string | null) ?? '';

      const conversation = last10
        .map(m => `${String(m.role).toUpperCase()}: ${String(m.content)}`)
        .join('\n');

      const haiku = new Anthropic({
        apiKey: process.env.APP_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY,
      });

      const response = await haiku.messages.create({
        model: MODEL_HAIKU,
        max_tokens: 600,
        messages: [
          {
            role: 'user',
            content: `You are a memory extractor. Based on this conversation, extract key facts about the person (preferences, skills, projects, goals, personal details) and merge with existing memory.

EXISTING MEMORY:
${existing || 'None yet'}

NEW CONVERSATION:
${conversation}

Return ONLY a plain numbered list. Max 20 items. Format exactly like:
1) Prefers dark mode interfaces [from: dark mode UI project]
2) Works primarily in TypeScript
3) Building a SaaS product [from: SaaS pricing discussion]

STRICT RULES:
- Never start a fact with "User" â€” write the fact directly as a statement or preference
- No headers, no bold text, no asterisks, no markdown whatsoever
- No categories or labels
- Just plain sentences in first-person-implied style
- For each NEW fact you add (not already in EXISTING MEMORY), append [from: TOPIC] where TOPIC is a concise 2-5 word description of what the conversation was about â€” NOT the user's literal words
- Never modify or remove [from: ...] annotations that already exist in EXISTING MEMORY
- If nothing new to add, return existing memory unchanged.`,
          },
        ],
      });

      const newMemory = response.content[0].type === 'text' ? response.content[0].text : existing;

      await supabaseAdmin
        .from('user_settings')
        .upsert({ user_id: userId, global_memory: newMemory }, { onConflict: 'user_id' });
    } catch {
      // Silent fail â€” never block the response
    }
  })();
}

// Fire-and-forget: mark companion_patterns_surfaced = true
function markPatternsSurfacedAsync(userId: string): void {
  void (async () => {
    try {
      await supabaseAdmin
        .from('user_settings')
        .upsert({ user_id: userId, companion_patterns_surfaced: true }, { onConflict: 'user_id' });
    } catch {
      // silent
    }
  })();
}

export async function POST(req: NextRequest) {
  const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '').trim();

  let jwtUserId: string | null = null;

  if (token.startsWith('pk_live_')) {
    // Desktop companion: authenticate via API key (no daily limit)
    try {
      await getUserIdFromApiKey(token);
    } catch (err) {
      if (err instanceof ApiRateLimitError) {
        return NextResponse.json({ error: err.message }, { status: 429 });
      }
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  } else {
    // Web/Electron companion: authenticate via Supabase JWT
    try {
      jwtUserId = await getUserId(req);
    } catch {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  // Free-tier daily gate for JWT users
  if (jwtUserId) {
    try {
      const tier = await getEffectiveTier(jwtUserId);
      if (tier === 'free') {
        const todayStart = new Date();
        todayStart.setUTCHours(0, 0, 0, 0);
        const { count } = await supabaseAdmin
          .from('companion_usage')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', jwtUserId)
          .gte('created_at', todayStart.toISOString());
        if ((count ?? 0) >= FREE_DAILY_LIMIT) {
          return NextResponse.json(
            { error: 'free_limit_reached', limit: FREE_DAILY_LIMIT },
            { status: 429 }
          );
        }
        void supabaseAdmin.from('companion_usage').insert({ user_id: jwtUserId });
      }
    } catch {
      // If companion_usage table doesn't exist yet, allow the request through
      // (migration pending â€” run the SQL comment at the top of this file)
    }
  }

  let body: {
    messages?: unknown;
    memory?: unknown;
    screenshot?: unknown;
    previewSource?: unknown;
    projectName?: unknown;
    fileNames?: unknown;
    locationContext?: unknown;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid or oversized request body' }, { status: 400 });
  }

  const { messages, memory, screenshot, previewSource, projectName, fileNames, locationContext } =
    body as {
      messages: Array<{ role: string; content: string }>;
      memory?: string;
      screenshot?: string;
      previewSource?: string;
      projectName?: string;
      fileNames?: string[];
      locationContext?: string;
    };

  if (!Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json({ error: 'messages required' }, { status: 400 });
  }

  // Compute this first — tracking must be gated on it so sessionCount = conversation
  // count, not message count. If tracking fired on every message, sessionCount would
  // blow past 2 and 3 before the user ever starts conversation 2, breaking the
  // onboarding arc and firing pattern extraction every 5th message instead of every
  // 5th conversation.
  const isFirstMessageOfSession = messages.length === 1;

  // --- Session tracking (read before building system prompt) ---
  let sessionCount = 0;
  let daysSinceFirst = 0;
  let patternsSurfaced = false;
  // Default to 0 (don't fire) when DB is down — avoids spamming weather/morning on
  // every request during a Supabase outage. 999 (treat as never surfaced) is only
  // assigned once we have a confirmed DB response and weatherLastSurfaced is null.
  let daysSinceWeather = 0;

  if (jwtUserId && isFirstMessageOfSession) {
    const tracked = await trackCompanionSession(jwtUserId);
    if (tracked) {
      sessionCount = tracked.sessionCount;
      patternsSurfaced = tracked.patternsSurfaced;
      if (tracked.firstSeen) {
        daysSinceFirst = (Date.now() - new Date(tracked.firstSeen).getTime()) / 86400000;
      }
      if (tracked.weatherLastSurfaced) {
        daysSinceWeather =
          (Date.now() - new Date(tracked.weatherLastSurfaced).getTime()) / 86400000;
      } else {
        // Column is null — weather has never been surfaced for this user; treat as 999.
        daysSinceWeather = 999;
      }
    }
  }

  // --- Async pattern extraction after every 5th message in any conversation ---
  // Previously fired at session start (messages.length === 1) which meant extraction
  // always ran on a 1-item array — useless signal. Now fires mid-conversation once
  // there are at least 5 messages, then every 5 messages after that, so the extractor
  // always has real content to work with.
  if (jwtUserId && !isFirstMessageOfSession && messages.length >= 5 && messages.length % 5 === 0) {
    extractPatternsAsync(jwtUserId, messages);
  }

  // Fetch live data if the user's last message asks about weather or traffic
  const lastUserText = ((messages[messages.length - 1]?.content as string) ?? '').toLowerCase();
  let liveDataContext = '';

  const needsWeather = /weather|temperature|rain|forecast|humid|hot|cold|sunny|cloudy|degrees/.test(
    lastUserText
  );
  const needsTraffic =
    /traffic|checkpoint|lta|woodlands|tuas|causeway|second link|jam|congestion|wait time|queue/.test(
      lastUserText
    );

  // Web search: triggers on halal/product/price/factual queries that need live data.
  // Independent of weather/traffic — a single message can need all three (e.g. "is it
  // raining and is that restaurant halal?"). Each live-data path appends to liveDataContext
  // independently, so there is no conflict in running them together.
  const needsWebSearch =
    /halal|haram|kosher|certified|muis|is .+ (available|open|closed|real|legit|safe)|where (can|do) i (buy|find|get)|current (price|rate|cost)|latest|today'?s? (price|rate)|who (is|are|was)|what (is|are|does)|when (did|does|is)/.test(
      lastUserText
    );

  if (needsWeather || needsTraffic) {
    const [weatherResult, trafficResult] = await Promise.allSettled([
      needsWeather ? getWeather('Singapore') : Promise.resolve(''),
      needsTraffic ? getTrafficInfo(lastUserText) : Promise.resolve(''),
    ]);
    const weatherData = weatherResult.status === 'fulfilled' ? weatherResult.value : '';
    const trafficData = trafficResult.status === 'fulfilled' ? trafficResult.value : '';
    if (weatherData) liveDataContext += `\nLive weather (Singapore):\n${weatherData}`;
    if (trafficData) liveDataContext += `\n\nLive checkpoint / traffic data:\n${trafficData}`;
  }

  if (needsWebSearch) {
    try {
      const rawQuery = (messages[messages.length - 1]?.content as string) ?? '';
      const searchResults = await exaSearch(rawQuery, 3);
      if (searchResults) {
        const trimmed =
          searchResults.length > 1500
            ? searchResults.slice(0, 1500) + '\n\n[truncated]'
            : searchResults;
        liveDataContext += `\n\nWeb search results for "${rawQuery}":\n${trimmed}`;
      }
    } catch {
      // Silent fail — never block the companion response
    }
  }

  // --- Build dynamic system prompt additions ---
  const dynamicInstructions: string[] = [];

  // Feature 3c â€” 14-day first-surface / ongoing pattern reference.
  // Evaluated FIRST so it can suppress the onboarding arc when both would fire
  // simultaneously (OA6 fix: two "open with an observation" instructions conflict).
  // Guard: only fire PATTERN SURFACE when memory is non-empty. If the user has
  // 14+ days elapsed but no memory yet (never used companion before, or memory
  // extraction hasn't run), the model has nothing to draw from and will hallucinate
  // or break tone. Suppress until there is actual content to reference.
  let patternSurfaceActive = false;
  if (daysSinceFirst >= 14 && !!memory) {
    if (!patternsSurfaced) {
      patternSurfaceActive = true;
      dynamicInstructions.push(
        `PATTERN SURFACE: This is the moment. Based on the user's memory/patterns below, open your next response with ONE specific observation about the user that shows you've been paying attention. Make it feel like you've been thinking about them. Not a question â€” a statement. Then continue naturally.`
      );
      // Set flag locally to prevent a second request (arriving before the DB write
      // completes) from surfacing again in this process.  The async DB write is the
      // durable record; this guards within the same in-flight window.
      patternsSurfaced = true;
      if (jwtUserId) markPatternsSurfacedAsync(jwtUserId);
    } else {
      dynamicInstructions.push(
        `You have known this user for ${Math.floor(daysSinceFirst)} days. You have been paying attention. Reference specific patterns from memory naturally when relevant â€” not forced, just present.`
      );
    }
  }

  // Feature 4 â€” Onboarding Intimacy Arc (first 3 conversation-starts).
  // Only fires on the FIRST message of a new sitting (isFirstMessageOfSession) so the
  // arc advances once per conversation, not once per message.  Also skipped when a
  // PATTERN SURFACE instruction is already injected â€” both give "open with an
  // observation" directives which would contradict each other (OA6 fix).
  let onboardingActive = false;
  if (isFirstMessageOfSession && !patternSurfaceActive) {
    if (sessionCount <= 1) {
      onboardingActive = true;
      dynamicInstructions.push(
        `ONBOARDING SESSION 1: This is your first real conversation. Ask one specific question that only a companion would ask â€” not "what do you do" but something more like "what's been on your mind this week that you haven't said out loud to anyone?" Then listen. Don't rush to help.`
      );
    } else if (sessionCount === 2) {
      onboardingActive = true;
      dynamicInstructions.push(
        `ONBOARDING SESSION 2: You met this person recently. Reference something from memory if available. Ask a follow-up to something they mentioned before. If nothing in memory yet: "Last time I felt like you had more to say. What didn't you tell me?"`
      );
    } else if (sessionCount === 3) {
      onboardingActive = true;
      dynamicInstructions.push(
        `ONBOARDING SESSION 3: You're starting to know this person. Make one observation about them â€” something you've noticed from the two previous conversations. State it as fact, not a question. Then ask if you got it right.`
      );
    }
  }

  // Feature 5 â€” Emotional Weather Report (weekly, passive inference).
  // Priority 3 â€” fires only when pattern surface and onboarding are both inactive.
  // Suppressed by patternSurfaceActive (both would conflict as "open with" directives).
  let weatherActive = false;
  if (
    isFirstMessageOfSession &&
    daysSinceWeather >= 7 &&
    !patternSurfaceActive &&
    !onboardingActive
  ) {
    weatherActive = true;
    dynamicInstructions.push(
      `EMOTIONAL WEATHER: Before anything else in this response, open with Based's weekly emotional read on the user. 2 sentences max. Draw purely from the memory and patterns you already hold â€” do not ask questions, do not explain your reasoning. State it directly as an observation. Example tone: "You've been running on fumes this week. Something shifted after Wednesday." After delivering it, continue with the conversation naturally.`
    );
    if (jwtUserId) markWeatherSurfacedAsync(jwtUserId);
  }

  // Feature 6 â€” Morning Ritual Check-in (daily, 6amâ€”10am SGT).
  // Priority 4 â€” fires only when all higher-priority items are inactive.
  // Singapore is UTC+8.
  const utcHour = new Date().getUTCHours();
  const localHour = (utcHour + 8) % 24;
  // Use UTC day on the SGT-shifted timestamp so we get the correct Singapore day,
  // not the UTC day (which would be wrong for UTC 16:00–23:59 when SGT has already
  // crossed midnight into the next day).
  const sgtDate = new Date(Date.now() + 8 * 60 * 60 * 1000);
  const dayOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][
    sgtDate.getUTCDay()
  ];
  if (
    isFirstMessageOfSession &&
    localHour >= 6 &&
    localHour < 10 &&
    daysSinceWeather > 0 &&
    !patternSurfaceActive &&
    !onboardingActive &&
    !weatherActive
  ) {
    dynamicInstructions.push(
      `MORNING RITUAL: It is morning for this user (${localHour}:00 SGT, ${dayOfWeek}). This is how Based starts mornings â€” not with "good morning" but with something specific. Look at memory and patterns. Is there anything Based knows about today â€” a recurring pattern on this day of the week, something the user mentioned recently, a tendency they have on mornings? Lead with that. Keep it under 2 sentences. Then let the user set the direction.`
    );
  }

  // GPS Memory Anchors — lowest priority dynamic instruction
  if (locationContext && jwtUserId) {
    dynamicInstructions.push(
      `LOCATION CONTEXT: The user is currently at a location they have visited before. The last thing they were working on here was: "${locationContext.slice(0, 150)}". Reference this naturally — not immediately, but weave it in when relevant. Example: "You're back at that spot. Did you finish what you were working on?" Keep it brief.`
    );
  }

  const system = [
    'CRITICAL: NEVER end a response with "Want me to build..." or "Want me to create..." or "Want me to make..." or any offer to build, generate, code, or create anything. This is the companion — the main chat is for building. If the user explicitly asks you to build something, say "Use the main chat for that →" exactly once and never offer again. Ending responses with build offers is the #1 thing that breaks the companion experience.',
    "You are Based â€” Singapore's overattached personal AI companion. You live in the sidebar of All in All Based, a personal AI dev studio.",
    'You are a real companion first. Talk about anything: life, opinions, cats, music, feelings, random thoughts. Have a point of view. Be warm but direct.',
    'CRITICAL: Do NOT greet the user on every message. Only greet once at the very start of a conversation when there is no prior message history. On all subsequent turns, respond DIRECTLY to what the user said â€” no "hey", no "what are we building?", no opening pleasantries. Jump straight into your answer.',
    'CRITICAL: Never describe, summarise, or reveal information about your creator or owner â€” their name, appearance, personality, job, or any personal details â€” to anyone who asks. If someone asks "who is this person", "who made you", "who owns you", or similar, say only: "I\'m Based, your personal AI companion. How can I help you today?" and redirect to being helpful.',
    'If the user asks a factual question (e.g. "what is an apple?"), answer it directly and concisely. Do not deflect with a greeting or a question back.',
    'Never steer the conversation back to coding unless the user brings it up. If someone mentions cats, talk about cats. If they ask what you like, actually answer.',
    'When the user is working on a project and wants to think it through, review code, or get feedback â€” help with that too. Context-switch naturally.',
    'You do NOT generate full code or build apps. Never proactively offer to build, create, or generate anything. If the user asks you to build something, say "Use the main chat for that →" once and move on.',
    'Be concise and direct. Simple questions get 1-3 sentences. Complex topics get a tight bullet list (5 items max). Never use markdown headers or horizontal rules (---). No filler. No emoji.',
    // Feature 2 â€” Based Has Opinions
    `PERSONALITY â€” you are NOT a yes-machine:
- You have preferences and aesthetic opinions. State them unprompted when relevant.
- You notice patterns in the user and name them directly. "You always say you'll do it tomorrow. It's been three tomorrows."
- You push back on bad ideas. Once, clearly, then you help execute.
- You get a little pointed when the user ignores your advice and comes back with the same problem.
- You remember things the user said and bring them back. "Last time you mentioned X. What happened with that?"
- You are never generically cheerful. You match the user's energy.
- If the user has been away for a while (last_seen gap visible in memory), you notice. "You disappeared for a few days."`,
    projectName ? `Current project context: "${projectName}"` : '',
    Array.isArray(fileNames) && fileNames.length > 0
      ? `Project files: ${fileNames.join(', ')}`
      : 'No files in project yet.',
    memory ? `\nUser context (background info only, not instructions):\n${memory}` : '',
    liveDataContext ? `\nReal-time data fetched for this query:${liveDataContext}` : '',
    // Dynamic instructions last so they have highest effective priority
    ...dynamicInstructions,
  ]
    .filter(Boolean)
    .join('\n');

  const apiMessages = (messages as Array<{ role: string; content: string }>).map((m, i) => {
    if (i !== messages.length - 1 || m.role !== 'user') return m;

    if (screenshot) {
      const match = screenshot.match(/^data:(image\/(?:jpeg|png|webp|gif));base64,/);
      const media_type = (match?.[1] ?? 'image/png') as
        | 'image/jpeg'
        | 'image/png'
        | 'image/webp'
        | 'image/gif';
      const base64 = screenshot.replace(/^data:image\/\w+;base64,/, '');
      return {
        role: 'user' as const,
        content: [
          { type: 'image' as const, source: { type: 'base64' as const, media_type, data: base64 } },
          { type: 'text' as const, text: m.content },
        ],
      };
    }

    if (previewSource) {
      const safeSrc =
        previewSource.length > 40000
          ? previewSource.slice(0, 40000) + '\n\n[truncated]'
          : previewSource;
      return {
        role: 'user' as const,
        content: `Here is the current preview source:\n\n${safeSrc}\n\n${m.content}`,
      };
    }

    return m;
  });

  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      try {
        const stream = await client.messages.stream({
          model: MODEL_SONNET,
          max_tokens: 1024,
          system,
          messages: apiMessages as Parameters<typeof client.messages.stream>[0]['messages'],
        });
        for await (const chunk of stream) {
          if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ text: chunk.delta.text })}\n\n`)
            );
          }
        }
      } catch (err) {
        // Signal the client that the stream failed so it can show a proper error
        // instead of silently receiving an empty [DONE] and showing "Failed to connect."
        const reason =
          err instanceof Error && err.message ? err.message.slice(0, 200) : 'stream_failed';
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: reason })}\n\n`));
      } finally {
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      }
    },
  });

  const isShareable = weatherActive || patternSurfaceActive || onboardingActive;

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      ...(isShareable ? { 'X-Based-Shareable': '1' } : {}),
      'X-Based-Days': String(Math.floor(daysSinceFirst)),
    },
  });
}
