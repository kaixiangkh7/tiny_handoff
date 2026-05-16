# Cloud Run Deployment

This app is ready to deploy to Google Cloud Run with the included `Dockerfile`.

## Deploy from this checkout

```bash
gcloud run deploy tiny-handoff \
  --source . \
  --region us-central1 \
  --allow-unauthenticated
```

After deploy, set the app URL values to the Cloud Run service URL:

```bash
gcloud run services update tiny-handoff \
  --region us-central1 \
  --set-env-vars NEXT_PUBLIC_APP_URL=https://YOUR-SERVICE-URL,TINY_DASHBOARD_URL=https://YOUR-SERVICE-URL
```

## Required runtime secrets

Configure these in Cloud Run before using the AI or Telegram features:

- `OPENAI_API_KEY`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_WEBHOOK_SECRET`

Optional values are listed in `.env.example`.

## Storage note

The current local JSON store writes to `.data` inside the container. On Cloud Run this storage is ephemeral, so data can reset when instances restart or scale. Use a managed store such as Firestore or Cloud SQL before relying on it for durable production data.
