# Pantheon Phase 1 — Core API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and deploy the Pantheon API — an AI orchestration service that routes every request to the best model per task type, with API key auth, credit billing, OpenAI-compatible and native endpoints, and a minimal developer dashboard. Wire it into Based as the owner client.

**Architecture:** Standalone Next.js 16 App Router service in a new repo (`pantheon-api`). Requests hit a middleware that validates API keys (stored in Supabase) and checks credit balance, then reach route handlers that invoke a Haiku-powered classifier to assign a `task_type`, which the router maps to the best upstream provider adapter. Credits are deducted atomically after each successful call. Stripe handles top-ups via Checkout + webhook.

**Tech Stack:** Next.js 16 App Router, TypeScript, Supabase (auth + Postgres), Upstash Redis, Anthropic SDK, `@google/generative-ai`, `@fal-ai/client`, `openai` (for DeepSeek), Stripe, Vitest

---

## File Map

```
pantheon-api/
├── app/
│   ├── layout.tsx                        minimal shell
│   ├── page.tsx                          landing — sign up / dashboard link
│   ├── dashboard/page.tsx                dev dashboard (keys, balance, usage)
│   └── api/
│       ├── v1/
│       │   ├── chat/completions/route.ts  OpenAI-compatible chat endpoint
│       │   ├── generate/route.ts          native image / music / video endpoint
│       │   ├── models/route.ts            list task_types + providers
│       │   └── credits/
│       │       ├── route.ts               GET balance
│       │       └── topup/route.ts         POST → Stripe Checkout redirect
│       └── webhooks/
│           └── stripe/route.ts            Stripe webhook → credit top-up
├── lib/
│   ├── supabase.ts                       Supabase client (server + browser)
│   ├── auth.ts                           API key validation + owner check
│   ├── credits.ts                        balance read, atomic deduction
│   ├── ratelimit.ts                      Redis sliding-window rate limiter
│   ├── classifier.ts                     Haiku intent → task_type
│   ├── router.ts                         task_type → provider + fallback
│   └── adapters/
│       ├── types.ts                      PantheonRequest / PantheonChunk types
│       ├── claude.ts                     Anthropic SDK streaming adapter
│       ├── gemini.ts                     Google Generative AI adapter
│       ├── deepseek.ts                   DeepSeek via openai-compat adapter
│       └── fal.ts                        FAL.ai image + music adapter
├── middleware.ts                         edge: extract key, rate limit, credit gate
├── supabase/
│   └── migrations/001_init.sql          tables: api_keys, credits, usage_logs
└── tests/
    ├── auth.test.ts
    ├── credits.test.ts
    ├── classifier.test.ts
    ├── router.test.ts
    └── adapters/
        ├── claude.test.ts
        ├── gemini.test.ts
        ├── deepseek.test.ts
        └── fal.test.ts
```

---

## Task 1: Project bootstrap

**Files:**

- Create: `pantheon-api/` (new repo)
- Create: `pantheon-api/package.json`
- Create: `pantheon-api/.env.local.example`
- Create: `pantheon-api/app/api/health/route.ts`

- [ ] **Step 1: Initialise the Next.js project**

```bash
cd ..   # one level above ai-dev-tool
npx create-next-app@latest pantheon-api \
  --typescript --app --no-src-dir \
  --tailwind --eslint --no-import-alias
cd pantheon-api
```

- [ ] **Step 2: Install dependencies**

```bash
npm install \
  @supabase/supabase-js \
  @anthropic-ai/sdk \
  @google/generative-ai \
  @fal-ai/client \
  openai \
  @upstash/redis \
  stripe \
  @stripe/stripe-js
npm install -D vitest @vitest/coverage-v8 vite-tsconfig-paths
```

- [ ] **Step 3: Add vitest config**

Create `vitest.config.ts`:

```typescript
import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: 'node',
    globals: true,
  },
});
```

Add to `package.json` scripts:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 4: Create `.env.local.example`**

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Upstash Redis
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=

# Provider API keys
ANTHROPIC_API_KEY=
GOOGLE_GENERATIVE_AI_API_KEY=
DEEPSEEK_API_KEY=
FAL_KEY=

# Stripe
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=

# Internal
PANTHEON_OWNER_KEY=pk_owner_based_internal
```

Copy to `.env.local` and fill in real values before running.

- [ ] **Step 5: Create health endpoint**

`app/api/health/route.ts`:

```typescript
export const runtime = 'edge';

export function GET() {
  return Response.json({ status: 'ok', ts: Date.now() });
}
```

- [ ] **Step 6: Verify server starts**

```bash
npm run dev
curl http://localhost:3001/api/health
# Expected: {"status":"ok","ts":...}
```

- [ ] **Step 7: Initialise git**

```bash
git init
echo ".env.local\n.next\nnode_modules" > .gitignore
git add .
git commit -m "chore: bootstrap pantheon-api Next.js project"
```

---

## Task 2: Supabase schema

**Files:**

- Create: `supabase/migrations/001_init.sql`
- Create: `lib/supabase.ts`

- [ ] **Step 1: Create Supabase project**

Go to supabase.com → New Project → name it `pantheon`. Save the project URL and keys into `.env.local`.

- [ ] **Step 2: Write migration**

`supabase/migrations/001_init.sql`:

```sql
-- API keys
create table api_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  key_hash text not null unique,   -- sha256 of the actual key
  key_prefix text not null,        -- first 12 chars shown in dashboard
  key_type text not null check (key_type in ('live', 'test', 'owner')),
  label text,
  created_at timestamptz default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

-- Credit balances (one row per user)
create table credits (
  user_id uuid primary key references auth.users(id) on delete cascade,
  balance integer not null default 0 check (balance >= 0),
  updated_at timestamptz default now()
);

-- Usage log (one row per API call)
create table usage_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id),
  api_key_id uuid references api_keys(id),
  task_type text not null,
  provider text not null,
  model text not null,
  credits_used integer not null,
  input_tokens integer,
  output_tokens integer,
  duration_ms integer,
  created_at timestamptz default now()
);

-- RLS: users can only see their own data
alter table api_keys enable row level security;
alter table credits enable row level security;
alter table usage_logs enable row level security;

create policy "own keys" on api_keys for all using (auth.uid() = user_id);
create policy "own credits" on credits for all using (auth.uid() = user_id);
create policy "own usage" on usage_logs for all using (auth.uid() = user_id);
```

- [ ] **Step 3: Run migration in Supabase dashboard**

Open Supabase dashboard → SQL Editor → paste `001_init.sql` → Run.

- [ ] **Step 4: Create Supabase client**

`lib/supabase.ts`:

```typescript
import { createClient } from '@supabase/supabase-js';

export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);
```

- [ ] **Step 5: Commit**

```bash
git add lib/supabase.ts supabase/
git commit -m "feat: supabase schema and client"
```

---

## Task 3: API key generation and validation

**Files:**

- Create: `lib/auth.ts`
- Create: `tests/auth.test.ts`

- [ ] **Step 1: Write failing tests**

`tests/auth.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock supabaseAdmin before importing auth
vi.mock('../lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}));

import { generateApiKey, validateApiKey, hashKey } from '../lib/auth';
import { supabaseAdmin } from '../lib/supabase';

describe('hashKey', () => {
  it('returns consistent 64-char hex hash', async () => {
    const h1 = await hashKey('test-key');
    const h2 = await hashKey('test-key');
    expect(h1).toBe(h2);
    expect(h1).toHaveLength(64);
  });

  it('different keys produce different hashes', async () => {
    const h1 = await hashKey('key-one');
    const h2 = await hashKey('key-two');
    expect(h1).not.toBe(h2);
  });
});

describe('generateApiKey', () => {
  it('returns key with correct prefix for live type', () => {
    const key = generateApiKey('live');
    expect(key.startsWith('pk_live_')).toBe(true);
    expect(key.length).toBeGreaterThan(20);
  });

  it('returns key with correct prefix for test type', () => {
    const key = generateApiKey('test');
    expect(key.startsWith('pk_test_')).toBe(true);
  });

  it('returns key with correct prefix for owner type', () => {
    const key = generateApiKey('owner');
    expect(key.startsWith('pk_owner_')).toBe(true);
  });
});

describe('validateApiKey', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null for missing key', async () => {
    const result = await validateApiKey('');
    expect(result).toBeNull();
  });

  it('returns null when key not found in db', async () => {
    const mockFrom = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          is: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: null, error: { code: 'PGRST116' } }),
          }),
        }),
      }),
    });
    vi.mocked(supabaseAdmin.from).mockImplementation(mockFrom);

    const result = await validateApiKey('pk_live_nonexistent');
    expect(result).toBeNull();
  });

  it('returns key record when valid', async () => {
    const fakeRecord = {
      id: 'key-id-123',
      user_id: 'user-id-456',
      key_type: 'live',
      revoked_at: null,
    };
    const mockFrom = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          is: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: fakeRecord, error: null }),
          }),
        }),
      }),
    });
    vi.mocked(supabaseAdmin.from).mockImplementation(mockFrom);

    const result = await validateApiKey('pk_live_somekey');
    expect(result).toEqual(fakeRecord);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- tests/auth.test.ts
# Expected: FAIL — generateApiKey / validateApiKey / hashKey not found
```

- [ ] **Step 3: Implement `lib/auth.ts`**

```typescript
import { supabaseAdmin } from './supabase';
import { createHash, randomBytes } from 'crypto';

export async function hashKey(key: string): Promise<string> {
  return createHash('sha256').update(key).digest('hex');
}

export function generateApiKey(type: 'live' | 'test' | 'owner'): string {
  const random = randomBytes(24).toString('base64url');
  return `pk_${type}_${random}`;
}

export type ValidatedKey = {
  id: string;
  user_id: string;
  key_type: 'live' | 'test' | 'owner';
  revoked_at: string | null;
};

export async function validateApiKey(key: string): Promise<ValidatedKey | null> {
  if (!key) return null;

  // Owner key — no DB lookup needed, static env check
  if (key === process.env.PANTHEON_OWNER_KEY) {
    return { id: 'owner', user_id: 'owner', key_type: 'owner', revoked_at: null };
  }

  const hash = await hashKey(key);

  const { data, error } = await supabaseAdmin
    .from('api_keys')
    .select('id, user_id, key_type, revoked_at')
    .eq('key_hash', hash)
    .is('revoked_at', null)
    .single();

  if (error || !data) return null;
  return data as ValidatedKey;
}

export function extractBearerToken(authHeader: string | null): string {
  if (!authHeader?.startsWith('Bearer ')) return '';
  return authHeader.slice(7);
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- tests/auth.test.ts
# Expected: PASS (6 tests)
```

- [ ] **Step 5: Commit**

```bash
git add lib/auth.ts tests/auth.test.ts
git commit -m "feat: API key generation and validation"
```

---

## Task 4: Credit ledger

**Files:**

- Create: `lib/credits.ts`
- Create: `tests/credits.test.ts`

- [ ] **Step 1: Write failing tests**

`tests/credits.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/supabase', () => ({
  supabaseAdmin: { from: vi.fn(), rpc: vi.fn() },
}));

import { getBalance, deductCredits, grantCredits } from '../lib/credits';
import { supabaseAdmin } from '../lib/supabase';

describe('getBalance', () => {
  it('returns 0 for unknown user', async () => {
    vi.mocked(supabaseAdmin.from).mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
        }),
      }),
    } as any);
    expect(await getBalance('unknown')).toBe(0);
  });

  it('returns balance for known user', async () => {
    vi.mocked(supabaseAdmin.from).mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: { balance: 450 }, error: null }),
        }),
      }),
    } as any);
    expect(await getBalance('user-123')).toBe(450);
  });
});

describe('deductCredits', () => {
  it('returns false when balance is insufficient', async () => {
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: false, error: null } as any);
    const ok = await deductCredits('user-123', 100);
    expect(ok).toBe(false);
  });

  it('returns true when deduction succeeds', async () => {
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: true, error: null } as any);
    const ok = await deductCredits('user-123', 10);
    expect(ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- tests/credits.test.ts
# Expected: FAIL
```

- [ ] **Step 3: Add SQL function for atomic deduction**

Run in Supabase SQL Editor:

```sql
create or replace function deduct_credits(p_user_id uuid, p_amount integer)
returns boolean language plpgsql as $$
begin
  update credits
    set balance = balance - p_amount, updated_at = now()
    where user_id = p_user_id and balance >= p_amount;
  return found;
end;
$$;
```

- [ ] **Step 4: Implement `lib/credits.ts`**

```typescript
import { supabaseAdmin } from './supabase';

export async function getBalance(userId: string): Promise<number> {
  const { data } = await supabaseAdmin
    .from('credits')
    .select('balance')
    .eq('user_id', userId)
    .single();
  return data?.balance ?? 0;
}

export async function deductCredits(userId: string, amount: number): Promise<boolean> {
  // owner key has infinite credits
  if (userId === 'owner') return true;

  const { data } = await supabaseAdmin.rpc('deduct_credits', {
    p_user_id: userId,
    p_amount: amount,
  });
  return data === true;
}

export async function grantCredits(userId: string, amount: number): Promise<void> {
  await supabaseAdmin.rpc('grant_credits', {
    p_user_id: userId,
    p_amount: amount,
  });
}

// Credit cost per task type
export const CREDIT_COST: Record<string, number> = {
  chat: 5,
  writing: 15,
  code: 25,
  math: 10,
  research: 35,
  video_analysis: 20,
  image: 8,
  music: 90,
  video_gen: 180,
};
```

Also add `grant_credits` SQL function in Supabase SQL Editor:

```sql
create or replace function grant_credits(p_user_id uuid, p_amount integer)
returns void language plpgsql as $$
begin
  insert into credits (user_id, balance)
    values (p_user_id, p_amount)
    on conflict (user_id)
    do update set balance = credits.balance + p_amount, updated_at = now();
end;
$$;
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npm test -- tests/credits.test.ts
# Expected: PASS (4 tests)
```

- [ ] **Step 6: Commit**

```bash
git add lib/credits.ts tests/credits.test.ts
git commit -m "feat: credit ledger with atomic deduction"
```

---

## Task 5: Redis rate limiting

**Files:**

- Create: `lib/ratelimit.ts`

- [ ] **Step 1: Implement `lib/ratelimit.ts`**

```typescript
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

// Sliding window: max `limit` requests per `windowSec` seconds per key
export async function checkRateLimit(
  apiKeyId: string,
  limit = 60,
  windowSec = 60
): Promise<{ allowed: boolean; remaining: number }> {
  const now = Date.now();
  const windowStart = now - windowSec * 1000;
  const redisKey = `rl:${apiKeyId}`;

  const pipe = redis.pipeline();
  pipe.zremrangebyscore(redisKey, 0, windowStart);
  pipe.zadd(redisKey, { score: now, member: now.toString() });
  pipe.zcard(redisKey);
  pipe.expire(redisKey, windowSec);

  const results = await pipe.exec();
  const count = results[2] as number;

  return {
    allowed: count <= limit,
    remaining: Math.max(0, limit - count),
  };
}
```

- [ ] **Step 2: Verify Redis connection**

Add a temporary test route `app/api/test-redis/route.ts`:

```typescript
import { checkRateLimit } from '@/lib/ratelimit';

export async function GET() {
  const result = await checkRateLimit('test-key', 5, 10);
  return Response.json(result);
}
```

```bash
npm run dev
# Hit the endpoint 6 times quickly:
for i in {1..6}; do curl http://localhost:3001/api/test-redis; echo; done
# Expected: first 5 show allowed:true, 6th shows allowed:false
```

Delete the test route after confirming.

- [ ] **Step 3: Commit**

```bash
git add lib/ratelimit.ts
git commit -m "feat: Redis sliding-window rate limiter"
```

---

## Task 6: Shared adapter types

**Files:**

- Create: `lib/adapters/types.ts`

- [ ] **Step 1: Write `lib/adapters/types.ts`**

```typescript
export type TaskType =
  | 'chat'
  | 'writing'
  | 'code'
  | 'math'
  | 'research'
  | 'video_analysis'
  | 'image'
  | 'music'
  | 'video_gen';

export type MessageRole = 'user' | 'assistant' | 'system';

export type Message = {
  role: MessageRole;
  content: string;
};

// Input to every adapter
export type PantheonRequest = {
  messages: Message[];
  task_type: TaskType;
  stream: boolean;
  max_tokens?: number;
  temperature?: number;
};

// What adapters yield during streaming
export type PantheonChunk =
  | { type: 'text'; text: string }
  | { type: 'done'; input_tokens: number; output_tokens: number; model: string }
  | { type: 'error'; message: string };

// What adapters return for non-streaming
export type PantheonResponse = {
  text: string;
  input_tokens: number;
  output_tokens: number;
  model: string;
};

// Generative media (image/music/video)
export type GenerateRequest = {
  task_type: 'image' | 'music' | 'video_gen';
  prompt: string;
  options?: Record<string, unknown>;
};

export type GenerateResponse = {
  url: string;
  format: string;
  duration?: number; // music/video seconds
  width?: number; // image
  height?: number; // image
  provider: string;
  model: string;
};
```

- [ ] **Step 2: Commit**

```bash
git add lib/adapters/types.ts
git commit -m "feat: shared adapter types"
```

---

## Task 7: Claude adapter

**Files:**

- Create: `lib/adapters/claude.ts`
- Create: `tests/adapters/claude.test.ts`

- [ ] **Step 1: Write failing tests**

`tests/adapters/claude.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { callClaude } from '../../lib/adapters/claude';
import type { PantheonRequest } from '../../lib/adapters/types';

vi.mock('@anthropic-ai/sdk', () => {
  const fakeStream = {
    async *[Symbol.asyncIterator]() {
      yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello' } };
      yield { type: 'message_delta', usage: { output_tokens: 3 } };
      yield { type: 'message_start', message: { usage: { input_tokens: 10 } } };
    },
  };
  return {
    default: class {
      messages = {
        stream: vi.fn().mockReturnValue(fakeStream),
      };
    },
  };
});

const req: PantheonRequest = {
  messages: [{ role: 'user', content: 'Hi' }],
  task_type: 'chat',
  stream: true,
};

describe('callClaude', () => {
  it('yields text chunks and a done event', async () => {
    const chunks = [];
    for await (const chunk of callClaude(req, 'claude-sonnet-4-6')) {
      chunks.push(chunk);
    }
    const textChunks = chunks.filter(c => c.type === 'text');
    const doneChunk = chunks.find(c => c.type === 'done');

    expect(textChunks.length).toBeGreaterThan(0);
    expect(doneChunk).toBeDefined();
    expect((doneChunk as any).output_tokens).toBe(3);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- tests/adapters/claude.test.ts
# Expected: FAIL
```

- [ ] **Step 3: Implement `lib/adapters/claude.ts`**

```typescript
import Anthropic from '@anthropic-ai/sdk';
import type { PantheonRequest, PantheonChunk } from './types';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Maps task_type to Claude model
export const CLAUDE_MODELS: Record<string, string> = {
  code: 'claude-opus-4-7',
  writing: 'claude-sonnet-4-6',
  chat: 'claude-sonnet-4-6',
  video_analysis: 'claude-sonnet-4-6',
};

export async function* callClaude(
  req: PantheonRequest,
  model: string
): AsyncGenerator<PantheonChunk> {
  const system = req.messages.find(m => m.role === 'system')?.content;
  const userMessages = req.messages
    .filter(m => m.role !== 'system')
    .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));

  let inputTokens = 0;
  let outputTokens = 0;

  const stream = client.messages.stream({
    model,
    max_tokens: req.max_tokens ?? 4096,
    system,
    messages: userMessages,
  });

  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      yield { type: 'text', text: event.delta.text };
    } else if (event.type === 'message_start') {
      inputTokens = event.message.usage.input_tokens;
    } else if (event.type === 'message_delta') {
      outputTokens = event.usage.output_tokens;
    }
  }

  yield { type: 'done', input_tokens: inputTokens, output_tokens: outputTokens, model };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- tests/adapters/claude.test.ts
# Expected: PASS
```

- [ ] **Step 5: Commit**

```bash
git add lib/adapters/claude.ts tests/adapters/claude.test.ts
git commit -m "feat: Claude streaming adapter"
```

---

## Task 8: Gemini adapter

**Files:**

- Create: `lib/adapters/gemini.ts`
- Create: `tests/adapters/gemini.test.ts`

- [ ] **Step 1: Write failing tests**

`tests/adapters/gemini.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { callGemini } from '../../lib/adapters/gemini';
import type { PantheonRequest } from '../../lib/adapters/types';

vi.mock('@google/generative-ai', () => {
  const fakeStream = {
    stream: (async function* () {
      yield { text: () => 'Gemini ', candidates: [{ content: { parts: [] } }] };
      yield { text: () => 'says hi', candidates: [{ content: { parts: [] } }] };
    })(),
    response: Promise.resolve({
      usageMetadata: { promptTokenCount: 8, candidatesTokenCount: 4 },
    }),
  };
  return {
    GoogleGenerativeAI: class {
      getGenerativeModel = vi.fn().mockReturnValue({
        generateContentStream: vi.fn().mockResolvedValue(fakeStream),
      });
    },
  };
});

const req: PantheonRequest = {
  messages: [{ role: 'user', content: 'Hello Gemini' }],
  task_type: 'research',
  stream: true,
};

describe('callGemini', () => {
  it('yields text chunks and done event', async () => {
    const chunks = [];
    for await (const chunk of callGemini(req, 'gemini-2.5-flash')) {
      chunks.push(chunk);
    }
    const text = chunks
      .filter(c => c.type === 'text')
      .map(c => (c as any).text)
      .join('');
    expect(text).toBe('Gemini says hi');
    expect(chunks.find(c => c.type === 'done')).toBeDefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- tests/adapters/gemini.test.ts
# Expected: FAIL
```

- [ ] **Step 3: Implement `lib/adapters/gemini.ts`**

```typescript
import { GoogleGenerativeAI } from '@google/generative-ai';
import type { PantheonRequest, PantheonChunk } from './types';

const client = new GoogleGenerativeAI(process.env.GOOGLE_GENERATIVE_AI_API_KEY!);

export async function* callGemini(
  req: PantheonRequest,
  model: string
): AsyncGenerator<PantheonChunk> {
  const genModel = client.getGenerativeModel({ model });

  // Convert messages to Gemini history format
  const history = req.messages
    .slice(0, -1)
    .filter(m => m.role !== 'system')
    .map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

  const lastMessage = req.messages.at(-1)!;
  const systemPrompt = req.messages.find(m => m.role === 'system')?.content;

  const result = await genModel.generateContentStream({
    systemInstruction: systemPrompt,
    contents: [...history, { role: 'user', parts: [{ text: lastMessage.content }] }],
  });

  for await (const chunk of result.stream) {
    const text = chunk.text();
    if (text) yield { type: 'text', text };
  }

  const response = await result.response;
  const usage = response.usageMetadata;
  yield {
    type: 'done',
    input_tokens: usage?.promptTokenCount ?? 0,
    output_tokens: usage?.candidatesTokenCount ?? 0,
    model,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- tests/adapters/gemini.test.ts
# Expected: PASS
```

- [ ] **Step 5: Commit**

```bash
git add lib/adapters/gemini.ts tests/adapters/gemini.test.ts
git commit -m "feat: Gemini streaming adapter"
```

---

## Task 9: DeepSeek adapter

**Files:**

- Create: `lib/adapters/deepseek.ts`
- Create: `tests/adapters/deepseek.test.ts`

DeepSeek exposes an OpenAI-compatible API. We use the `openai` SDK pointed at DeepSeek's base URL.

- [ ] **Step 1: Write failing tests**

`tests/adapters/deepseek.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { callDeepSeek } from '../../lib/adapters/deepseek';
import type { PantheonRequest } from '../../lib/adapters/types';

vi.mock('openai', () => {
  async function* fakeStream() {
    yield { choices: [{ delta: { content: 'Answer: 42' } }], usage: null };
    yield { choices: [{ delta: {} }], usage: { prompt_tokens: 5, completion_tokens: 3 } };
  }
  return {
    default: class {
      chat = {
        completions: {
          create: vi.fn().mockResolvedValue(fakeStream()),
        },
      };
    },
  };
});

const req: PantheonRequest = {
  messages: [{ role: 'user', content: 'What is 6 * 7?' }],
  task_type: 'math',
  stream: true,
};

describe('callDeepSeek', () => {
  it('yields text and done', async () => {
    const chunks = [];
    for await (const c of callDeepSeek(req, 'deepseek-reasoner')) {
      chunks.push(c);
    }
    const text = chunks
      .filter(c => c.type === 'text')
      .map(c => (c as any).text)
      .join('');
    expect(text).toBe('Answer: 42');
    expect(chunks.find(c => c.type === 'done')).toBeDefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- tests/adapters/deepseek.test.ts
# Expected: FAIL
```

- [ ] **Step 3: Implement `lib/adapters/deepseek.ts`**

```typescript
import OpenAI from 'openai';
import type { PantheonRequest, PantheonChunk } from './types';

const client = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: 'https://api.deepseek.com',
});

export async function* callDeepSeek(
  req: PantheonRequest,
  model: string
): AsyncGenerator<PantheonChunk> {
  const messages = req.messages.map(m => ({ role: m.role, content: m.content }));

  const stream = await client.chat.completions.create({
    model,
    messages,
    stream: true,
    stream_options: { include_usage: true },
    max_tokens: req.max_tokens ?? 8192,
  });

  let inputTokens = 0;
  let outputTokens = 0;

  for await (const chunk of stream) {
    const text = chunk.choices[0]?.delta?.content;
    if (text) yield { type: 'text', text };
    if (chunk.usage) {
      inputTokens = chunk.usage.prompt_tokens;
      outputTokens = chunk.usage.completion_tokens;
    }
  }

  yield { type: 'done', input_tokens: inputTokens, output_tokens: outputTokens, model };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- tests/adapters/deepseek.test.ts
# Expected: PASS
```

- [ ] **Step 5: Commit**

```bash
git add lib/adapters/deepseek.ts tests/adapters/deepseek.test.ts
git commit -m "feat: DeepSeek adapter via OpenAI-compat client"
```

---

## Task 10: FAL adapter (image + music)

**Files:**

- Create: `lib/adapters/fal.ts`
- Create: `tests/adapters/fal.test.ts`

- [ ] **Step 1: Write failing tests**

`tests/adapters/fal.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { callFal } from '../../lib/adapters/fal';
import type { GenerateRequest } from '../../lib/adapters/types';

vi.mock('@fal-ai/client', () => ({
  fal: {
    config: vi.fn(),
    run: vi.fn().mockResolvedValue({
      images: [{ url: 'https://fal.ai/output/test.png', width: 1024, height: 1024 }],
    }),
  },
}));

describe('callFal image', () => {
  it('returns image url and dimensions', async () => {
    const req: GenerateRequest = {
      task_type: 'image',
      prompt: 'A red apple on a table',
    };
    const result = await callFal(req);
    expect(result.url).toBe('https://fal.ai/output/test.png');
    expect(result.format).toBe('png');
    expect(result.width).toBe(1024);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- tests/adapters/fal.test.ts
# Expected: FAIL
```

- [ ] **Step 3: Implement `lib/adapters/fal.ts`**

```typescript
import { fal } from '@fal-ai/client';
import type { GenerateRequest, GenerateResponse } from './types';

fal.config({ credentials: process.env.FAL_KEY });

const FAL_MODELS = {
  image: 'fal-ai/flux/schnell', // swap to nano-banana when available
  music: 'fal-ai/stable-audio',
  video_gen: 'fal-ai/seedance-1-lite',
};

export async function callFal(req: GenerateRequest): Promise<GenerateResponse> {
  const model = FAL_MODELS[req.task_type];

  if (req.task_type === 'image') {
    const result = (await fal.run(model, {
      input: {
        prompt: req.prompt,
        ...(req.options ?? {}),
      },
    })) as any;

    const image = result.images?.[0];
    return {
      url: image.url,
      format: image.url.split('.').pop() ?? 'png',
      width: image.width,
      height: image.height,
      provider: 'fal',
      model,
    };
  }

  if (req.task_type === 'music') {
    const result = (await fal.run(model, {
      input: {
        prompt: req.prompt,
        seconds_total: (req.options?.duration as number) ?? 30,
      },
    })) as any;

    return {
      url: result.audio_file?.url ?? result.audio?.url,
      format: 'mp3',
      duration: (req.options?.duration as number) ?? 30,
      provider: 'fal',
      model,
    };
  }

  // video_gen
  const result = (await fal.run(model, {
    input: { prompt: req.prompt, ...(req.options ?? {}) },
  })) as any;

  return {
    url: result.video?.url,
    format: 'mp4',
    provider: 'fal',
    model,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- tests/adapters/fal.test.ts
# Expected: PASS
```

- [ ] **Step 5: Commit**

```bash
git add lib/adapters/fal.ts tests/adapters/fal.test.ts
git commit -m "feat: FAL.ai adapter for image, music, video generation"
```

---

## Task 11: Intent classifier

**Files:**

- Create: `lib/classifier.ts`
- Create: `tests/classifier.test.ts`

- [ ] **Step 1: Write failing tests**

`tests/classifier.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { classifyIntent } from '../lib/classifier';
import type { TaskType } from '../lib/adapters/types';

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = {
      create: vi.fn().mockImplementation(({ messages }: any) => {
        const prompt = messages[0].content as string;
        let task = 'chat';
        if (prompt.includes('math')) task = 'math';
        if (prompt.includes('image')) task = 'image';
        if (prompt.includes('music')) task = 'music';
        return Promise.resolve({ content: [{ type: 'text', text: task }] });
      }),
    };
  },
}));

describe('classifyIntent', () => {
  it('classifies chat message as chat', async () => {
    const t = await classifyIntent([{ role: 'user', content: 'How are you?' }]);
    expect(t).toBe('chat');
  });

  it('classifies math request as math', async () => {
    const t = await classifyIntent([
      { role: 'user', content: 'Solve this math problem: integral of x^2' },
    ]);
    expect(t).toBe('math');
  });

  it('passes through explicit task_type without calling Claude', async () => {
    const t = await classifyIntent([{ role: 'user', content: 'anything' }], 'code');
    expect(t).toBe('code');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- tests/classifier.test.ts
# Expected: FAIL
```

- [ ] **Step 3: Implement `lib/classifier.ts`**

```typescript
import Anthropic from '@anthropic-ai/sdk';
import type { Message, TaskType } from './adapters/types';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const VALID_TASK_TYPES: TaskType[] = [
  'chat',
  'writing',
  'code',
  'math',
  'research',
  'video_analysis',
  'image',
  'music',
  'video_gen',
];

const SYSTEM = `You are a task classifier. Given a user message, respond with exactly one word — the task type:
- chat: general conversation, questions, explanations
- writing: essays, stories, emails, professional writing
- code: programming, debugging, software architecture
- math: mathematics, algorithms, logic puzzles
- research: factual research requiring up-to-date information or multiple sources
- video_analysis: analysing or describing video content
- image: generating an image or illustration
- music: generating music, audio, or sound
- video_gen: generating a video clip

Respond with only the task type word. Nothing else.`;

export async function classifyIntent(
  messages: Message[],
  explicitTaskType?: string
): Promise<TaskType> {
  // Skip classifier if caller already knows the task type
  if (explicitTaskType && VALID_TASK_TYPES.includes(explicitTaskType as TaskType)) {
    return explicitTaskType as TaskType;
  }

  const lastUserMessage = [...messages].reverse().find(m => m.role === 'user');
  if (!lastUserMessage) return 'chat';

  const response = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 10,
    system: SYSTEM,
    messages: [{ role: 'user', content: lastUserMessage.content }],
  });

  const raw = (response.content[0] as any).text.trim().toLowerCase();
  return VALID_TASK_TYPES.includes(raw as TaskType) ? (raw as TaskType) : 'chat';
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- tests/classifier.test.ts
# Expected: PASS
```

- [ ] **Step 5: Commit**

```bash
git add lib/classifier.ts tests/classifier.test.ts
git commit -m "feat: Haiku-powered intent classifier"
```

---

## Task 12: Router

**Files:**

- Create: `lib/router.ts`
- Create: `tests/router.test.ts`

- [ ] **Step 1: Write failing tests**

`tests/router.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { resolveProvider } from '../lib/router';

describe('resolveProvider', () => {
  it('routes code to claude opus', () => {
    const p = resolveProvider('code');
    expect(p.adapter).toBe('claude');
    expect(p.model).toBe('claude-opus-4-7');
  });

  it('routes math to deepseek', () => {
    const p = resolveProvider('math');
    expect(p.adapter).toBe('deepseek');
    expect(p.model).toContain('deepseek');
  });

  it('routes image to fal', () => {
    const p = resolveProvider('image');
    expect(p.adapter).toBe('fal');
  });

  it('falls back to claude when primary fails', () => {
    const primary = resolveProvider('math');
    const fallback = resolveProvider('math', primary.adapter);
    expect(fallback.adapter).toBe('claude');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- tests/router.test.ts
# Expected: FAIL
```

- [ ] **Step 3: Implement `lib/router.ts`**

```typescript
import type { TaskType } from './adapters/types';

type AdapterName = 'claude' | 'gemini' | 'deepseek' | 'fal';

export type ProviderRoute = {
  adapter: AdapterName;
  model: string;
};

type RouteEntry = {
  primary: ProviderRoute;
  fallback: ProviderRoute;
};

const ROUTES: Record<TaskType, RouteEntry> = {
  code: {
    primary: { adapter: 'claude', model: 'claude-opus-4-7' },
    fallback: { adapter: 'claude', model: 'claude-sonnet-4-6' },
  },
  writing: {
    primary: { adapter: 'claude', model: 'claude-sonnet-4-6' },
    fallback: { adapter: 'gemini', model: 'gemini-2.5-flash' },
  },
  chat: {
    primary: { adapter: 'claude', model: 'claude-sonnet-4-6' },
    fallback: { adapter: 'gemini', model: 'gemini-2.5-flash' },
  },
  math: {
    primary: { adapter: 'deepseek', model: 'deepseek-reasoner' },
    fallback: { adapter: 'claude', model: 'claude-sonnet-4-6' },
  },
  research: {
    primary: { adapter: 'gemini', model: 'gemini-2.5-pro' },
    fallback: { adapter: 'claude', model: 'claude-sonnet-4-6' },
  },
  video_analysis: {
    primary: { adapter: 'gemini', model: 'gemini-2.5-pro' },
    fallback: { adapter: 'gemini', model: 'gemini-2.5-flash' },
  },
  image: {
    primary: { adapter: 'fal', model: 'fal-ai/flux/schnell' },
    fallback: { adapter: 'fal', model: 'fal-ai/flux/schnell' },
  },
  music: {
    primary: { adapter: 'fal', model: 'fal-ai/stable-audio' },
    fallback: { adapter: 'fal', model: 'fal-ai/stable-audio' },
  },
  video_gen: {
    primary: { adapter: 'fal', model: 'fal-ai/seedance-1-lite' },
    fallback: { adapter: 'fal', model: 'fal-ai/seedance-1-lite' },
  },
};

export function resolveProvider(taskType: TaskType, excludeAdapter?: AdapterName): ProviderRoute {
  const route = ROUTES[taskType];
  if (!excludeAdapter || route.primary.adapter !== excludeAdapter) {
    return route.primary;
  }
  return route.fallback;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- tests/router.test.ts
# Expected: PASS
```

- [ ] **Step 5: Commit**

```bash
git add lib/router.ts tests/router.test.ts
git commit -m "feat: task router with fallback"
```

---

## Task 13: Middleware (auth + rate limit gate)

**Files:**

- Create: `middleware.ts`

The Next.js middleware runs at the edge before every `/api/v1/*` request. It validates the API key and attaches the user context to the request headers so route handlers don't repeat that work.

- [ ] **Step 1: Implement `middleware.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { validateApiKey, extractBearerToken } from './lib/auth';
import { checkRateLimit } from './lib/ratelimit';

export const config = {
  matcher: '/api/v1/:path*',
};

export async function middleware(req: NextRequest) {
  const token = extractBearerToken(req.headers.get('authorization'));

  if (!token) {
    return NextResponse.json({ error: 'Missing API key' }, { status: 401 });
  }

  const keyRecord = await validateApiKey(token);

  if (!keyRecord) {
    return NextResponse.json({ error: 'Invalid or revoked API key' }, { status: 401 });
  }

  // Rate limiting (skip for owner key)
  if (keyRecord.key_type !== 'owner') {
    const limit = keyRecord.key_type === 'test' ? 10 : 60;
    const { allowed, remaining } = await checkRateLimit(keyRecord.id, limit);

    if (!allowed) {
      return NextResponse.json(
        { error: 'Rate limit exceeded' },
        {
          status: 429,
          headers: {
            'X-RateLimit-Remaining': '0',
            'Retry-After': '60',
          },
        }
      );
    }

    const response = NextResponse.next();
    response.headers.set('X-RateLimit-Remaining', remaining.toString());
    response.headers.set('X-Pantheon-User-Id', keyRecord.user_id);
    response.headers.set('X-Pantheon-Key-Id', keyRecord.id);
    response.headers.set('X-Pantheon-Key-Type', keyRecord.key_type);
    return response;
  }

  // Owner key — pass through with owner headers
  const response = NextResponse.next();
  response.headers.set('X-Pantheon-User-Id', 'owner');
  response.headers.set('X-Pantheon-Key-Id', 'owner');
  response.headers.set('X-Pantheon-Key-Type', 'owner');
  return response;
}
```

- [ ] **Step 2: Verify middleware blocks invalid keys**

```bash
npm run dev
# No key:
curl -X POST http://localhost:3001/api/v1/chat/completions
# Expected: {"error":"Missing API key"} 401

# Invalid key:
curl -X POST http://localhost:3001/api/v1/chat/completions \
  -H "Authorization: Bearer pk_live_fake"
# Expected: {"error":"Invalid or revoked API key"} 401
```

- [ ] **Step 3: Commit**

```bash
git add middleware.ts
git commit -m "feat: edge middleware for API key auth and rate limiting"
```

---

## Task 14: OpenAI-compatible chat endpoint

**Files:**

- Create: `app/api/v1/chat/completions/route.ts`

This is the core endpoint. Wires together: middleware context → credits check → classifier → router → adapter → streaming response → credit deduction → usage log.

- [ ] **Step 1: Implement the endpoint**

`app/api/v1/chat/completions/route.ts`:

```typescript
import { NextRequest } from 'next/server';
import { classifyIntent } from '@/lib/classifier';
import { resolveProvider } from '@/lib/router';
import { deductCredits, CREDIT_COST } from '@/lib/credits';
import { callClaude } from '@/lib/adapters/claude';
import { callGemini } from '@/lib/adapters/gemini';
import { callDeepSeek } from '@/lib/adapters/deepseek';
import { supabaseAdmin } from '@/lib/supabase';
import type { Message, TaskType, PantheonChunk } from '@/lib/adapters/types';

export const runtime = 'nodejs';
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const userId = req.headers.get('X-Pantheon-User-Id')!;
  const keyId = req.headers.get('X-Pantheon-Key-Id')!;
  const keyType = req.headers.get('X-Pantheon-Key-Type')!;

  const body = await req.json();
  const messages: Message[] = body.messages ?? [];
  const explicitTaskType: string | undefined = body.pantheon?.task_type;
  const stream: boolean = body.stream ?? false;

  // Classify intent
  const taskType: TaskType = await classifyIntent(messages, explicitTaskType);

  // Credit check (skip for owner and test keys)
  const cost = CREDIT_COST[taskType] ?? CREDIT_COST.chat;
  if (keyType === 'live') {
    const ok = await deductCredits(userId, cost);
    if (!ok) {
      return Response.json({ error: 'Insufficient credits' }, { status: 402 });
    }
  }

  // Resolve provider
  let route = resolveProvider(taskType);

  // Call adapter (with one automatic fallback)
  const callAdapter = (r: ReturnType<typeof resolveProvider>) =>
    r.adapter === 'claude'
      ? callClaude({ messages, task_type: taskType, stream: true }, r.model)
      : r.adapter === 'gemini'
        ? callGemini({ messages, task_type: taskType, stream: true }, r.model)
        : callDeepSeek({ messages, task_type: taskType, stream: true }, r.model);

  const encoder = new TextEncoder();
  let inputTokens = 0;
  let outputTokens = 0;
  let usedModel = route.model;

  const readable = new ReadableStream({
    async start(controller) {
      let gen: AsyncGenerator<PantheonChunk>;

      try {
        gen = callAdapter(route);
      } catch {
        // Primary failed — try fallback
        route = resolveProvider(taskType, route.adapter);
        gen = callAdapter(route);
        usedModel = route.model;
      }

      try {
        for await (const chunk of gen) {
          if (chunk.type === 'text') {
            // OpenAI SSE format
            const data = JSON.stringify({
              id: `chatcmpl-${Date.now()}`,
              object: 'chat.completion.chunk',
              choices: [{ delta: { content: chunk.text }, index: 0, finish_reason: null }],
            });
            controller.enqueue(encoder.encode(`data: ${data}\n\n`));
          } else if (chunk.type === 'done') {
            inputTokens = chunk.input_tokens;
            outputTokens = chunk.output_tokens;
            usedModel = chunk.model;
            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          }
        }
      } catch (err) {
        const errData = JSON.stringify({ error: 'Stream error' });
        controller.enqueue(encoder.encode(`data: ${errData}\n\n`));
      } finally {
        controller.close();

        // Log usage (fire and forget)
        if (keyId !== 'owner') {
          supabaseAdmin
            .from('usage_logs')
            .insert({
              user_id: userId,
              api_key_id: keyId,
              task_type: taskType,
              provider: route.adapter,
              model: usedModel,
              credits_used: cost,
              input_tokens: inputTokens,
              output_tokens: outputTokens,
            })
            .then(() => {});
        }
      }
    },
  });

  if (!stream) {
    // Collect full response for non-streaming clients
    let fullText = '';
    const gen = callAdapter(route);
    for await (const chunk of gen) {
      if (chunk.type === 'text') fullText += chunk.text;
      if (chunk.type === 'done') {
        inputTokens = chunk.input_tokens;
        outputTokens = chunk.output_tokens;
      }
    }
    return Response.json({
      id: `chatcmpl-${Date.now()}`,
      object: 'chat.completion',
      choices: [
        {
          message: { role: 'assistant', content: fullText },
          finish_reason: 'stop',
          index: 0,
        },
      ],
      usage: { prompt_tokens: inputTokens, completion_tokens: outputTokens },
      model: `pantheon-auto (${usedModel})`,
    });
  }

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Pantheon-Task-Type': taskType,
      'X-Pantheon-Model': usedModel,
    },
  });
}
```

- [ ] **Step 2: Test with owner key**

Create a test owner key entry in Supabase (or just use the env var):

```bash
npm run dev

curl -X POST http://localhost:3001/api/v1/chat/completions \
  -H "Authorization: Bearer pk_owner_based_internal" \
  -H "Content-Type: application/json" \
  -d '{"model":"pantheon-auto","messages":[{"role":"user","content":"Say hello in one word"}],"stream":false}'

# Expected: {"id":"chatcmpl-...","choices":[{"message":{"role":"assistant","content":"Hello"},...}]}
```

- [ ] **Step 3: Test streaming**

```bash
curl -X POST http://localhost:3001/api/v1/chat/completions \
  -H "Authorization: Bearer pk_owner_based_internal" \
  -H "Content-Type: application/json" \
  -d '{"model":"pantheon-auto","messages":[{"role":"user","content":"Count to 3"}],"stream":true}'

# Expected: SSE stream of data: {...} lines ending with data: [DONE]
```

- [ ] **Step 4: Commit**

```bash
git add app/api/v1/chat/completions/route.ts
git commit -m "feat: OpenAI-compatible /v1/chat/completions endpoint"
```

---

## Task 15: Native generate endpoint

**Files:**

- Create: `app/api/v1/generate/route.ts`

- [ ] **Step 1: Implement the endpoint**

`app/api/v1/generate/route.ts`:

```typescript
import { NextRequest } from 'next/server';
import { callFal } from '@/lib/adapters/fal';
import { deductCredits, CREDIT_COST } from '@/lib/credits';
import { supabaseAdmin } from '@/lib/supabase';
import type { TaskType } from '@/lib/adapters/types';

export const runtime = 'nodejs';
export const maxDuration = 120;

const GENERATE_TASK_TYPES: TaskType[] = ['image', 'music', 'video_gen'];

export async function POST(req: NextRequest) {
  const userId = req.headers.get('X-Pantheon-User-Id')!;
  const keyId = req.headers.get('X-Pantheon-Key-Id')!;
  const keyType = req.headers.get('X-Pantheon-Key-Type')!;

  const body = await req.json();
  const taskType: TaskType = body.task_type;
  const prompt: string = body.prompt;
  const options = body.options ?? {};

  if (!GENERATE_TASK_TYPES.includes(taskType)) {
    return Response.json(
      { error: `task_type must be one of: ${GENERATE_TASK_TYPES.join(', ')}` },
      { status: 400 }
    );
  }

  if (!prompt?.trim()) {
    return Response.json({ error: 'prompt is required' }, { status: 400 });
  }

  const cost = CREDIT_COST[taskType];
  if (keyType === 'live') {
    const ok = await deductCredits(userId, cost);
    if (!ok) {
      return Response.json({ error: 'Insufficient credits' }, { status: 402 });
    }
  }

  const startMs = Date.now();
  const result = await callFal({ task_type: taskType, prompt, options });

  if (keyId !== 'owner') {
    supabaseAdmin
      .from('usage_logs')
      .insert({
        user_id: userId,
        api_key_id: keyId,
        task_type: taskType,
        provider: 'fal',
        model: result.model,
        credits_used: cost,
        duration_ms: Date.now() - startMs,
      })
      .then(() => {});
  }

  return Response.json({
    id: `gen_${Date.now()}`,
    task_type: taskType,
    status: 'completed',
    output: result,
    credits_used: cost,
    provider: result.provider,
  });
}
```

- [ ] **Step 2: Test image generation**

```bash
curl -X POST http://localhost:3001/api/v1/generate \
  -H "Authorization: Bearer pk_owner_based_internal" \
  -H "Content-Type: application/json" \
  -d '{"task_type":"image","prompt":"A glowing neon sign in a rainy city street"}'

# Expected: {"id":"gen_...","output":{"url":"https://...","format":"png",...}}
```

- [ ] **Step 3: Commit**

```bash
git add app/api/v1/generate/route.ts
git commit -m "feat: native /v1/generate endpoint for image, music, video"
```

---

## Task 16: Stripe credits top-up

**Files:**

- Create: `app/api/v1/credits/topup/route.ts`
- Create: `app/api/webhooks/stripe/route.ts`
- Create: `app/api/v1/credits/route.ts`

- [ ] **Step 1: Credits balance endpoint**

`app/api/v1/credits/route.ts`:

```typescript
import { NextRequest } from 'next/server';
import { getBalance } from '@/lib/credits';

export async function GET(req: NextRequest) {
  const userId = req.headers.get('X-Pantheon-User-Id')!;

  if (userId === 'owner') {
    return Response.json({ balance: Infinity, used_this_month: 0 });
  }

  const balance = await getBalance(userId);
  return Response.json({ balance });
}
```

- [ ] **Step 2: Stripe top-up endpoint**

`app/api/v1/credits/topup/route.ts`:

```typescript
import { NextRequest } from 'next/server';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

// Credit packages: amount in cents → credits granted
const PACKAGES = [
  { cents: 1000, credits: 1000, label: '$10 — 1,000 credits' },
  { cents: 2500, credits: 3000, label: '$25 — 3,000 credits' },
  { cents: 5000, credits: 7000, label: '$50 — 7,000 credits' },
];

export async function POST(req: NextRequest) {
  const userId = req.headers.get('X-Pantheon-User-Id')!;
  const body = await req.json();
  const pkg = PACKAGES.find(p => p.cents === body.amount_cents) ?? PACKAGES[0];

  const session = await stripe.checkout.sessions.create({
    payment_method_types: ['card'],
    line_items: [
      {
        price_data: {
          currency: 'usd',
          product_data: { name: `Pantheon Credits — ${pkg.credits.toLocaleString()} credits` },
          unit_amount: pkg.cents,
        },
        quantity: 1,
      },
    ],
    mode: 'payment',
    success_url: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard?credits=success`,
    cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard?credits=cancelled`,
    metadata: { user_id: userId, credits: pkg.credits.toString() },
  });

  return Response.json({ checkout_url: session.url });
}
```

- [ ] **Step 3: Stripe webhook handler**

`app/api/webhooks/stripe/route.ts`:

```typescript
import { NextRequest } from 'next/server';
import Stripe from 'stripe';
import { grantCredits } from '@/lib/credits';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export async function POST(req: NextRequest) {
  const body = await req.text();
  const sig = req.headers.get('stripe-signature')!;

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch {
    return Response.json({ error: 'Invalid signature' }, { status: 400 });
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    const userId = session.metadata?.user_id;
    const credits = parseInt(session.metadata?.credits ?? '0', 10);

    if (userId && credits > 0) {
      await grantCredits(userId, credits);
    }
  }

  return Response.json({ received: true });
}
```

Add `NEXT_PUBLIC_APP_URL=http://localhost:3001` to `.env.local`.

- [ ] **Step 4: Test webhook locally with Stripe CLI**

```bash
# Install Stripe CLI if not already: https://stripe.com/docs/stripe-cli
stripe listen --forward-to localhost:3001/api/webhooks/stripe
# In another terminal, trigger a test event:
stripe trigger checkout.session.completed
# Expected: webhook logs show credits granted
```

- [ ] **Step 5: Commit**

```bash
git add app/api/v1/credits/ app/api/webhooks/
git commit -m "feat: Stripe credit top-up and webhook handler"
```

---

## Task 17: Based integration — wire owner key

**Files:**

- Modify: `ai-dev-tool/.env.local`
- Modify: `ai-dev-tool/app/api/generate/route.ts`

- [ ] **Step 1: Add Pantheon owner key to Based's env**

In `ai-dev-tool/.env.local`, add:

```bash
PANTHEON_API_URL=http://localhost:3001   # change to https://api.pantheon.ai after deploy
PANTHEON_OWNER_KEY=pk_owner_based_internal
```

- [ ] **Step 2: Create a Pantheon client helper in Based**

`ai-dev-tool/lib/pantheon.ts`:

```typescript
const PANTHEON_URL = process.env.PANTHEON_API_URL!;
const PANTHEON_KEY = process.env.PANTHEON_OWNER_KEY!;

export async function* streamPantheonChat(
  messages: { role: string; content: string }[],
  taskType?: string
): AsyncGenerator<string> {
  const res = await fetch(`${PANTHEON_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${PANTHEON_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'pantheon-auto',
      messages,
      stream: true,
      pantheon: taskType ? { task_type: taskType } : undefined,
    }),
  });

  if (!res.ok) {
    throw new Error(`Pantheon error: ${res.status}`);
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const lines = decoder.decode(value).split('\n');
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6);
      if (data === '[DONE]') return;
      try {
        const parsed = JSON.parse(data);
        const text = parsed.choices?.[0]?.delta?.content;
        if (text) yield text;
      } catch {}
    }
  }
}
```

- [ ] **Step 3: Verify end-to-end**

Start both servers:

```bash
# Terminal 1 — Pantheon
cd pantheon-api && npm run dev

# Terminal 2 — Based
cd ai-dev-tool && npm run dev
```

Open Based at `http://localhost:3000`, send a chat message, confirm it flows through Pantheon (check Pantheon server logs for incoming requests).

- [ ] **Step 4: Commit**

```bash
cd ai-dev-tool
git add lib/pantheon.ts .env.local.example
git commit -m "feat: Pantheon client helper for Based integration"
```

---

## Task 18: Run full test suite + deploy

- [ ] **Step 1: Run all tests**

```bash
cd pantheon-api
npm test
# Expected: all tests pass
```

- [ ] **Step 2: Deploy Pantheon to Vercel**

```bash
# Install Vercel CLI if needed
npm i -g vercel

cd pantheon-api
vercel --prod
```

Set all env vars in the Vercel dashboard (copy from `.env.local`). Update Stripe webhook URL to the production Vercel URL.

- [ ] **Step 3: Update Based to point at production Pantheon**

In `ai-dev-tool/.env.local`:

```bash
PANTHEON_API_URL=https://pantheon-api.vercel.app
```

- [ ] **Step 4: Smoke test production**

```bash
curl -X POST https://pantheon-api.vercel.app/api/health
# Expected: {"status":"ok"}

curl -X POST https://pantheon-api.vercel.app/v1/chat/completions \
  -H "Authorization: Bearer pk_owner_based_internal" \
  -H "Content-Type: application/json" \
  -d '{"model":"pantheon-auto","messages":[{"role":"user","content":"ping"}],"stream":false}'
# Expected: valid completion response
```

- [ ] **Step 5: Final commit**

```bash
cd ai-dev-tool
git add .env.local.example
git commit -m "chore: point Based at production Pantheon API"
```

---

## Phase 1 Complete — What ships

| Capability                                 | Status |
| ------------------------------------------ | ------ |
| API key auth (live/test/owner)             | ✅     |
| Redis rate limiting                        | ✅     |
| Credit ledger + atomic deduction           | ✅     |
| Intent classifier (Haiku)                  | ✅     |
| Router with fallback                       | ✅     |
| Claude adapter (streaming)                 | ✅     |
| Gemini adapter (streaming)                 | ✅     |
| DeepSeek R1 adapter                        | ✅     |
| FAL.ai adapter (image/music/video)         | ✅     |
| `/v1/chat/completions` (OpenAI-compatible) | ✅     |
| `/v1/generate` (native media endpoint)     | ✅     |
| Stripe credit top-up                       | ✅     |
| Based wired to Pantheon                    | ✅     |

**Phase 2 next:** Anthropic-compatible `/v1/messages`, Suno + Perplexity adapters, `/v1/research`, VSCode extension.
