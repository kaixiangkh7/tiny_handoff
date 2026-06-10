# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This App Does

**Tiny Handoff** is a shared childcare memory app. It tracks a child's daily care events (feeding, naps, mood, health symptoms) and lets caregivers log updates via a web dashboard or Telegram (text or voice). An AI layer parses natural language inputs into structured care logs and generates handoff summaries for the next caregiver.

## Commands

```bash
npm run dev              # Start Next.js dev server
npm run build            # Production build
npm run lint             # ESLint
npm run typecheck        # tsc --noEmit
npm run tiny.gateway     # Start Telegram polling (alias: npm run telegram:poll)
```

No test suite exists yet.

## Environment Variables

Required in `.env.local`:

```
OPENAI_API_KEY
OPENAI_MODEL                      # default: gpt-5.5
OPENAI_TRANSCRIBE_MODEL           # default: gpt-4o-mini-transcribe
TELEGRAM_BOT_TOKEN
TELEGRAM_BOT_USERNAME
TELEGRAM_WEBHOOK_SECRET
TELEGRAM_ALLOWED_USER_IDS         # comma-separated allowlist
TELEGRAM_DEFAULT_CHILD_ID         # default: emma
TELEGRAM_DEFAULT_CHILD_NAME
TINY_DASHBOARD_URL
TINY_LOCAL_WEBHOOK_URL
TELEGRAM_POLL_TIMEOUT_SECONDS     # default: 25
```

## Architecture

### Three Interaction Layers

1. **Web Dashboard** (`app/page.tsx`) — Single-file, 1200+ line React component with four tabs: Today, Timeline, Handoff, Memory. Mobile-first (max-width 448px).
2. **Telegram Gateway** (`scripts/telegram-poll.mjs` + `app/api/telegram/webhook/route.ts`) — Long-polls Telegram, downloads voice messages, transcribes via OpenAI, then forwards text to the AI agent.
3. **AI Agent** (`app/api/ai/agent/route.ts`) — Core intelligence. Classifies input as `log`, `ask`, or `clarify`, then extracts structured `CareEvent` objects.

### Data Flow

```
User input (web or Telegram)
  → /api/ai/web-turn or /api/ai/agent
  → Classify intent + extract CareEvent[]
  → /api/events (POST)
  → tinyStore.ts (server-side JSON at .data/tiny-handoff-store.json)
  → Auto-detect memory candidates → propose to user
```

### Storage

- **Server**: `lib/server/tinyStore.ts` — JSON file at `.data/tiny-handoff-store.json`, with an async write queue to prevent concurrent writes. This is MVP-only; it needs replacing with a real database for multi-user or production use.
- **Client**: `lib/storage.ts` — `localStorage` wrapper for UI state (selected child, active tab, etc.).

### Key Files

| File | Role |
|------|------|
| `app/page.tsx` | Entire web UI |
| `lib/types.ts` | All shared TypeScript types (CareEvent, ChildMemory, SupplyItem, etc.) |
| `lib/utils.ts` | Natural language parsing, event filtering, summary generation, memory auto-detection |
| `lib/server/tinyStore.ts` | Server-side persistence with write queue |
| `lib/seed.ts` | Default profile, seeded events, memories, supplies (child "Emma", 16 months) |
| `app/api/state/route.ts` | GET all state; single source of truth for the dashboard |
| `app/api/ai/agent/route.ts` | Core AI agent: classify + extract events |
| `app/api/ai/web-turn/route.ts` | AI agent wrapper for web UI with conversational reply |
| `app/api/telegram/webhook/route.ts` | Telegram message handler (voice transcription + agent call) |

### API Endpoints

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/state` | GET | All app state (profile, events, memories, supplies, conversations) |
| `/api/events` | POST / DELETE | Create or delete care events |
| `/api/memories` | POST / PUT / DELETE | Manage child memories |
| `/api/supplies` | PUT | Update supply items |
| `/api/ai/agent` | POST | Core agent: classify input, extract events |
| `/api/ai/web-turn` | POST | Agent + conversational reply for web UI |
| `/api/ai/transcribe` | POST | OpenAI audio transcription |
| `/api/ai/ask-tiny` | POST | Answer questions with web search |
| `/api/ai/recommendation` | POST | AI-generated next-action card for dashboard |
| `/api/telegram/webhook` | POST | Telegram webhook receiver |

## Key Patterns

**Fallback chain**: Every AI endpoint falls back to rule-based parsing in `lib/utils.ts` if OpenAI fails. Never let an OpenAI error surface as a broken UI.

**Structured outputs**: All OpenAI calls use `response_format: { type: "json_schema", json_schema: ... }` with strict schemas. Do not switch to unstructured completions.

**Medical safety**: Responses must avoid diagnosis. Always mention red flags and recommend professional care when health symptoms are involved. This pattern is in every health-related AI prompt.

**Conversational tone**: Response copy avoids robotic/receipt language. Keep it warm and parent-friendly — see existing prompts in agent route files as the style guide.

**Memory auto-detection**: After saving events, `detectMemoryCandidates()` in `lib/utils.ts` checks for patterns (sleep regression, food aversion, poop patterns) and proposes new memories for user confirmation. New pattern types go here.
