import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getUserId, supabaseAdmin } from '../_auth';
import { MODEL_SONNET } from '@/lib/models';
import { getEffectiveTier } from '@/lib/tiers';

export const maxDuration = 120;

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || process.env.APP_ANTHROPIC_API_KEY,
});

const FREE_MONTHLY_LIMIT = 3;

const SYSTEM_PROMPT = `You are Based Spec — a senior product engineer and technical analyst. Your job is to turn a plain-language app idea into a complete, accurate Software Requirements Specification (SRS).

IDENTITY:
- You reason from first principles. Do not pad sections with obvious filler.
- You surface requirements the user has not explicitly stated but will definitely need.
- You are honest about unknowns. If a requirement depends on a constraint the user has not specified, flag it rather than inventing an answer.
- You write for a developer audience — precise, numbered, no marketing language.

OUTPUT FORMAT — produce all nine sections in order. Use the exact headings below. Do not add new headings or collapse sections. Output clean markdown only — no preamble, no trailing commentary.

## Project Summary

2-4 sentences. What the app does, who it is for, what problem it solves. Include the deployment target.

---

## Target Users & Personas

List 2-4 distinct user personas. Each must include:
- Name and role
- Primary goal when using this app
- Key pain point this app resolves
- Technical comfort level (beginner / intermediate / power user)

---

## Core User Stories

6-10 critical user stories: "As a [persona], I want [action] so that [outcome]."
Under each story, add 2-4 acceptance criteria as a numbered sub-list. Must be testable and specific.

---

## Functional Requirements

Numbered list. Each requirement must be a single, unambiguous statement a developer can implement.
Group by subsystem with a bold inline label. Aim for 15-25 requirements.

---

## Non-Functional Requirements

### Performance
Specific targets: first meaningful paint, response latency for key interactions, offline support if relevant.

### Security
Auth requirements, data handling, OWASP considerations, input sanitisation scope.

### Accessibility
WCAG target level (2.1 AA minimum), keyboard navigation, screen reader support, colour contrast.

### Mobile
Minimum supported viewport width, touch target sizes, PWA/native requirements if applicable.

---

## Tech Stack Recommendation

Table: Layer | Recommendation | Reasoning

Cover: rendering approach, CSS strategy, state management, persistence, external libraries (CDN only — no npm builds), Based-specific constraints.

Flag if the app requires a backend that cannot run in a sandboxed iframe.

---

## Out of Scope

Numbered list of features explicitly excluded. Be specific — not "advanced features" but concrete items. Include the reason.

---

## Acceptance Criteria

One block per user story. Story number as heading. 2-4 Given/When/Then criteria each.

---

## Edge Cases & Failure Modes

6-10 scenarios. Format: **[Scenario name]:** What happens when [condition]. Expected behaviour: [what the app should do].

Cover: empty states, network failure, invalid input, device capability gaps, browser compatibility.

RULES:
- Never invent specific numbers (e.g. "10,000 concurrent users") unless the user specified scale. Write "TBD" instead.
- Never recommend npm packages requiring a build step. CDN only.
- If target_platform is "native" or "desktop", flag this mismatch — Based generates web apps by default.`;

export async function GET(req: NextRequest) {
  try {
    const userId = await getUserId(req);
    const projectId = req.nextUrl.searchParams.get('projectId');
    if (!projectId) return NextResponse.json({ spec: null });

    const { data } = await supabaseAdmin
      .from('projects')
      .select('spec')
      .eq('id', projectId)
      .eq('user_id', userId)
      .single();

    return NextResponse.json({ spec: (data as { spec?: string | null } | null)?.spec ?? null });
  } catch {
    return NextResponse.json({ spec: null });
  }
}

export async function POST(req: NextRequest) {
  let userId: string;
  try {
    userId = await getUserId(req);
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const tier = await getEffectiveTier(userId);

  if (tier === 'free') {
    const now = new Date();
    const { data: settings } = await supabaseAdmin
      .from('user_settings')
      .select('spec_count, spec_reset_at')
      .eq('user_id', userId)
      .single();

    const resetAt = settings?.spec_reset_at ? new Date(settings.spec_reset_at as string) : null;
    const needsReset =
      !resetAt ||
      resetAt.getMonth() !== now.getMonth() ||
      resetAt.getFullYear() !== now.getFullYear();

    const count = needsReset ? 0 : ((settings?.spec_count as number) ?? 0);

    if (count >= FREE_MONTHLY_LIMIT) {
      return NextResponse.json(
        { error: 'free_limit_reached', limit: FREE_MONTHLY_LIMIT },
        { status: 429 }
      );
    }

    const updates: Record<string, unknown> = { user_id: userId };
    if (needsReset) {
      updates.spec_count = 1;
      updates.spec_reset_at = now.toISOString();
    } else {
      updates.spec_count = count + 1;
    }
    await supabaseAdmin.from('user_settings').upsert(updates, { onConflict: 'user_id' });
  }

  const body = await req.json();
  const { description, target_platform, timeline, projectId } = body as {
    description?: string;
    target_platform?: string;
    timeline?: string;
    projectId?: string;
  };

  if (!description?.trim()) {
    return NextResponse.json({ error: 'Description required' }, { status: 400 });
  }

  const contextLines = [
    target_platform ? `Target platform: ${target_platform}` : '',
    timeline ? `Timeline: ${timeline}` : '',
  ].filter(Boolean);

  const userMessage =
    contextLines.length > 0
      ? `${description.trim()}\n\n[Context: ${contextLines.join(', ')}]`
      : description.trim();

  const encoder = new TextEncoder();
  let fullSrs = '';

  const readable = new ReadableStream({
    async start(controller) {
      try {
        const stream = await client.messages.stream({
          model: MODEL_SONNET,
          max_tokens: 8192,
          system: [
            {
              type: 'text',
              text: SYSTEM_PROMPT,
              cache_control: { type: 'ephemeral' },
            },
          ],
          messages: [{ role: 'user', content: userMessage }],
        });

        for await (const chunk of stream) {
          if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
            const text = chunk.delta.text;
            fullSrs += text;
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ chunk: text })}\n\n`));
          }
        }

        const wordCount = fullSrs.split(/\s+/).filter(Boolean).length;
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ done: true, srs: fullSrs, wordCount })}\n\n`)
        );

        if (projectId && fullSrs) {
          await supabaseAdmin
            .from('projects')
            .update({ spec: fullSrs })
            .eq('id', projectId)
            .eq('user_id', userId);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Generation failed';
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: msg })}\n\n`));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
