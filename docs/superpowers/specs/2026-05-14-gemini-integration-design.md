# Gemini Integration Design

**Date:** 2026-05-14  
**Scope:** Add proper Gemini API integration as automatic fallback provider  
**Context:** Current setup has Claude.ai subscription (default) and Anthropic API (pay-as-you-go). Gemini integration failed previously because Claude Code is Anthropic SDK-based and validates model names against Claude models.

## Overview

This design adds native Gemini API support as an **automatic fallback provider**. When Claude generation fails, the system automatically retries using Gemini with an equivalent model tier. Users see a transparent notification that the fallback occurred.

## Architecture

### API Integration

- Add `@google/generative-ai` SDK alongside existing Anthropic SDK
- Both SDKs coexist in `app/api/generate/route.ts`
- No changes to existing Claude/Anthropic flow for normal operation

### Generation Pipeline

Three-step flow remains unchanged:

1. **Planner** — outputs JSON file plan
2. **File generator** — generates files individually
3. **Summary** — 1-2 sentence reply

Each step wraps Claude calls in try-catch:

```
Try: Call Claude with Planner system prompt
On error: Call Gemini with Planner system prompt
Log fallback message to user
Continue to next step
```

Fallback happens **per-step**, not globally. If planner succeeds with Claude but generator fails, only the generator falls back to Gemini.

### Model Mapping

Map Claude models to Gemini equivalents:
| Claude | Gemini |
|--------|--------|
| opus-4.7 | gemini-2.0 (or 1.5 if needed) |
| sonnet-4.6 | gemini-1.5-flash |
| haiku-4.5 | gemini-1.5-flash |

Mapping is deterministic: extract Claude model from environment or system context, translate to Gemini equivalent.

## Configuration

### Environment Variables

| Variable             | Source                   | Purpose                                          |
| -------------------- | ------------------------ | ------------------------------------------------ |
| `ANTHROPIC_API_KEY`  | PowerShell or .env.local | Claude API key (subscription or Anthropic)       |
| `GEMINI_API_KEY`     | PowerShell or .env.local | Gemini API key (free tier from Google AI Studio) |
| `ANTHROPIC_BASE_URL` | PowerShell               | Optional: custom Anthropic endpoint              |

### Provider Switching (PowerShell)

```powershell
use-subscription    # Claude only (no fallback)
use-anthropic       # Anthropic API only (no fallback)
use-gemini          # Gemini only (or with Claude fallback?)
```

**Decision needed:** Should `use-gemini` mean:

- Option A: Use Gemini as primary, Claude as fallback
- Option B: Use Gemini as primary only (no fallback)

**Recommendation:** Option A (symmetric to current design). Users who want Gemini-only can use it, but if it fails they silently fall back to Claude.

## User Experience

### Fallback Notification

When fallback occurs, append message to chat:

```
[Based] Switched to Gemini (Claude unavailable) — response may differ
```

Appears in chat stream like a normal message. No blocking dialogs or interruptions.

### Error Visibility

- User sees the generated code/response (from whichever provider succeeded)
- System logs which provider was used to console (for debugging)
- No breaking errors—fallback is transparent

## Error Handling

### Failure Scenarios

1. **Claude fails, Gemini succeeds** → Use Gemini response, log notification
2. **Claude fails, Gemini fails** → Return error (can't generate)
3. **Claude succeeds** → Use Claude response, no fallback
4. **Gemini API key missing** → Fall back disabled, only use Claude

### Implementation

```typescript
async function generateWithFallback(prompt, system, fallbackModel) {
  try {
    return await anthropic.messages.create(...)
  } catch (claudeError) {
    if (!process.env.GEMINI_API_KEY) throw claudeError;
    try {
      const result = await gemini.generateContent(...);
      notifyUserOfFallback();
      return result;
    } catch (geminiError) {
      throw new Error(`Both Claude and Gemini failed: ${claudeError.message}`);
    }
  }
}
```

## Implementation Scope

### Files to Modify

1. `app/api/generate/route.ts` — Add Gemini SDK, fallback logic, model mapping
2. `package.json` — Add `@google/generative-ai` dependency
3. `.env.local` — Add `GEMINI_API_KEY`
4. `CLAUDE.md` — Document Gemini setup and model equivalents
5. PowerShell profile — Update `use-gemini` function (already exists)

### Files to Create

None (reuse existing provider switching pattern)

## Testing Strategy

1. **Happy path:** Generate code with Claude (no fallback needed)
2. **Fallback path:** Simulate Claude failure, verify Gemini kicks in
3. **Both fail:** Verify error message is helpful
4. **Missing Gemini key:** Verify Claude-only works, no crash
5. **Model mapping:** Verify correct Gemini model picked for each Claude tier

## Success Criteria

- ✅ Gemini API integration works end-to-end
- ✅ Automatic fallback on Claude failure
- ✅ User sees notification of fallback
- ✅ Model mapping is correct (opus → 2.0, sonnet → 1.5-flash)
- ✅ No breaking changes to existing Claude/Anthropic flow
- ✅ Code is maintainable (fallback logic isolated, easy to debug)

## Open Questions

1. Should `use-gemini` use Gemini as primary or fallback?
   - **Recommendation:** Gemini as primary, Claude as fallback (symmetric design)
2. Should we support Gemini-specific features (vision, etc.) or keep it minimal?
   - **Recommendation:** Keep minimal for MVP, add later if needed
3. Should fallback respect model switching, or always use best available?
   - **Recommendation:** Respect model mapping (opus → 2.0 equivalent)
