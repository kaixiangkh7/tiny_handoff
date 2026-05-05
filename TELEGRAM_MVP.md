# Tiny Handoff Telegram MVP

Tiny can run as a Hermes-style Telegram gateway: parents text or voice-message the bot from Telegram, Tiny parses the message with the same app agent, saves care events to the shared local store, and replies with a short confirmation plus the dashboard link.

## Current Architecture

Local development uses polling:

```text
Telegram -> tiny.gateway polling process -> local Next.js API -> Tiny agent/store
```

Production can still use webhooks:

```text
Telegram -> deployed /api/telegram/webhook -> Tiny agent/store
```

The polling gateway clears any active Telegram webhook before polling, matching the Hermes local-dev style.

## Current Scope

- Telegram text messages are supported.
- Telegram voice/audio messages are downloaded and transcribed with OpenAI.
- Tiny classifies each message as log, ask, or clarify.
- Extracted care events are saved to the shared development store.
- Proposed memories are updated after saved events.
- Tiny replies in Telegram with a short response and dashboard link.
- Private chats respond normally.
- Group chats respond only when Tiny is mentioned or replied to.

Important: the current shared store is a local JSON file under `.data/`. This is enough for local MVP testing, but production needs Postgres, Supabase, or another durable database.

## Environment

Add these to `.env.local`:

```env
OPENAI_API_KEY=sk-your-key-here
OPENAI_MODEL=gpt-5.5
OPENAI_TRANSCRIBE_MODEL=gpt-4o-mini-transcribe

TELEGRAM_BOT_TOKEN=123456:your-telegram-bot-token
TELEGRAM_BOT_USERNAME=your_bot_username
TELEGRAM_WEBHOOK_SECRET=choose-a-random-secret
TELEGRAM_ALLOWED_USER_IDS=
TELEGRAM_DEFAULT_CHILD_ID=emma
TELEGRAM_DEFAULT_CHILD_NAME=Emma

TINY_DASHBOARD_URL=http://127.0.0.1:3000
TINY_LOCAL_WEBHOOK_URL=http://127.0.0.1:3000/api/telegram/webhook
TELEGRAM_POLL_TIMEOUT_SECONDS=25
```

For first local testing, `TELEGRAM_ALLOWED_USER_IDS` can be empty. Before sharing the bot, set it to a comma-separated allowlist of Telegram user IDs.

## Create Telegram Bot

1. Open Telegram.
2. Message `@BotFather`.
3. Run `/newbot`.
4. Copy the bot token into `TELEGRAM_BOT_TOKEN`.
5. Copy the bot username into `TELEGRAM_BOT_USERNAME` without `@`.

## Local Testing, Hermes-Style

Run the web app in terminal 1:

```bash
npm run dev
```

Run the Telegram gateway in terminal 2:

```bash
npm run tiny.gateway
```

Then message the bot:

```text
Emma drank 4 oz water, had a normal poop, and we need wipes tomorrow.
```

Expected result:

- Tiny replies in Telegram.
- New events are saved to `.data/tiny-handoff-store.json`.
- Refresh `http://127.0.0.1:3000/` and Today/Timeline should reflect the update.

Voice note test:

```text
Send a Telegram voice note: Emma napped from 1 to 2:20 and seemed tired after snack.
```

Expected result:

- Tiny sends a short listening/transcription response.
- The message is transcribed through OpenAI.
- Parsed events are saved if the agent can identify them.

## Production Webhook

Use webhook mode when the app is deployed or when testing with a public tunnel.

Expose local server with ngrok:

```bash
ngrok http 3000
```

Set the webhook:

```bash
curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  -d "url=https://YOUR-TUNNEL.ngrok-free.app/api/telegram/webhook" \
  -d "secret_token=$TELEGRAM_WEBHOOK_SECRET"
```

Webhook mode and polling mode should not run at the same time. Starting `npm run tiny.gateway` clears the webhook so polling can receive updates.

## Scripts

```bash
npm run dev
npm run tiny.gateway
npm run telegram:poll
```

`tiny.gateway` and `telegram:poll` run the same local polling gateway. `tiny.gateway` is the preferred command.

## Safety Defaults

- `TELEGRAM_ALLOWED_USER_IDS` limits who can use the bot.
- Leave `TELEGRAM_ALLOWED_USER_IDS` empty only for local testing.
- In private chats, Tiny responds normally.
- In group/supergroup chats, Tiny responds only when mentioned as `@TELEGRAM_BOT_USERNAME` or when someone replies to Tiny.
- `/start` returns a short onboarding message.
- Medical replies must stay tracking-oriented and avoid diagnosis.
- Serious symptoms should recommend contacting a pediatrician or urgent care depending on severity.

## Troubleshooting

If Tiny does not respond:

- Confirm `npm run dev` is running.
- Confirm `npm run tiny.gateway` is running in a second terminal.
- Confirm `TELEGRAM_BOT_TOKEN` is set in `.env.local`.
- Confirm `TINY_LOCAL_WEBHOOK_URL` points to `http://127.0.0.1:3000/api/telegram/webhook`.
- If using `TELEGRAM_ALLOWED_USER_IDS`, confirm your Telegram user ID is listed.
- If you previously configured webhook mode, restart `npm run tiny.gateway`; it clears the webhook on startup.

If the web dashboard does not update:

- Refresh the browser.
- Check `.data/tiny-handoff-store.json`.
- Confirm the Telegram message was specific enough to parse as care events.

## Next Required Step

Replace the local JSON store with a real backend database so Telegram and the web dashboard remain durable across deployments, devices, and multiple caregivers.
