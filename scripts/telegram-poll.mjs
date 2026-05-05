import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

loadEnvFile(".env.local");
loadEnvFile(".env");

const token = process.env.TELEGRAM_BOT_TOKEN;
const secret = process.env.TELEGRAM_WEBHOOK_SECRET ?? "";
const localWebhookUrl = process.env.TINY_LOCAL_WEBHOOK_URL ?? "http://127.0.0.1:3000/api/telegram/webhook";
const pollTimeoutSeconds = Number(process.env.TELEGRAM_POLL_TIMEOUT_SECONDS ?? 25);

if (!token) {
  console.error("TELEGRAM_BOT_TOKEN is missing. Add it to .env.local first.");
  process.exit(1);
}

let offset = Number(process.env.TELEGRAM_POLL_OFFSET ?? 0);
let stopping = false;

process.on("SIGINT", () => {
  stopping = true;
  console.log("\nStopping Telegram polling...");
});

process.on("SIGTERM", () => {
  stopping = true;
});

try {
  await telegramApi("deleteWebhook", { drop_pending_updates: false });
} catch (error) {
  console.error(formatGatewayError(error));
  process.exit(1);
}

console.log(`Tiny Telegram polling started. Forwarding updates to ${localWebhookUrl}`);

while (!stopping) {
  try {
    const payload = await telegramApi("getUpdates", {
      offset: offset || undefined,
      timeout: pollTimeoutSeconds,
      allowed_updates: ["message"],
    });

    for (const update of payload.result ?? []) {
      offset = update.update_id + 1;
      await forwardToLocalWebhook(update);
    }
  } catch (error) {
    console.error(formatGatewayError(error));
    await sleep(3000);
  }
}

function loadEnvFile(fileName) {
  const path = resolve(process.cwd(), fileName);
  if (!existsSync(path)) return;

  for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const separatorIndex = line.indexOf("=");
    if (separatorIndex === -1) continue;

    const key = line.slice(0, separatorIndex).trim();
    const value = line
      .slice(separatorIndex + 1)
      .trim()
      .replace(/^['"]|['"]$/g, "");

    if (!process.env[key]) process.env[key] = value;
  }
}

async function telegramApi(method, body) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    throw new Error(`Telegram ${method} failed: ${payload.description ?? response.statusText}`);
  }
  return payload;
}

async function forwardToLocalWebhook(update) {
  const headers = { "Content-Type": "application/json" };
  if (secret) headers["x-telegram-bot-api-secret-token"] = secret;

  const response = await fetch(localWebhookUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(update),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Local webhook failed: ${response.status} ${detail}`);
  }
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function formatGatewayError(error) {
  const message = error instanceof Error ? error.message : String(error);
  const cause = error?.cause instanceof Error ? error.cause.message : "";
  const detail = `${message} ${cause}`.trim();

  if (detail.includes("dnsblocknotice.capgemini.com") || detail.includes("ERR_TLS_CERT_ALTNAME_INVALID")) {
    return [
      "Telegram gateway cannot reach api.telegram.org from this network.",
      "The network appears to be returning a Capgemini DNS block page/certificate instead of Telegram.",
      "Try another network, hotspot, or an approved network/VPN path, then run npm run tiny.gateway again.",
    ].join(" ");
  }

  return detail || "Telegram gateway failed.";
}
