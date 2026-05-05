import OpenAI from "openai";
import { NextRequest, NextResponse } from "next/server";
import { appendConversation, appendEvents, getTinyState, upsertStoredMemory } from "@/lib/server/tinyStore";
import { CareEvent, TinyConversationMessage } from "@/lib/types";
import { detectMemoryCandidates } from "@/lib/utils";

export const runtime = "nodejs";

type TelegramMessage = {
  message_id: number;
  chat: { id: number | string; type?: "private" | "group" | "supergroup" | "channel" };
  text?: string;
  caption?: string;
  entities?: Array<{ type: string; offset: number; length: number }>;
  caption_entities?: Array<{ type: string; offset: number; length: number }>;
  voice?: { file_id: string; mime_type?: string };
  audio?: { file_id: string; mime_type?: string };
  from?: { id: number; first_name?: string; username?: string };
  reply_to_message?: { from?: { username?: string; is_bot?: boolean } };
  date?: number;
};

type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
};

const botToken = () => process.env.TELEGRAM_BOT_TOKEN;
const dashboardUrl = () => process.env.TINY_DASHBOARD_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://127.0.0.1:3000";
const botUsername = () => process.env.TELEGRAM_BOT_USERNAME?.replace(/^@/, "").toLowerCase();

function allowedUserIds() {
  return new Set(
    (process.env.TELEGRAM_ALLOWED_USER_IDS ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean),
  );
}

function isAllowedSender(message: TelegramMessage) {
  const allowed = allowedUserIds();
  if (!allowed.size) return true;
  return message.from?.id ? allowed.has(String(message.from.id)) : false;
}

function isGroupChat(message: TelegramMessage) {
  return message.chat.type === "group" || message.chat.type === "supergroup";
}

function isMentioned(text: string, entities: TelegramMessage["entities"]) {
  const username = botUsername();
  if (!username) return false;
  if (text.toLowerCase().includes(`@${username}`)) return true;
  return Boolean(
    entities?.some((entity) => {
      if (entity.type !== "mention") return false;
      return text.slice(entity.offset, entity.offset + entity.length).toLowerCase() === `@${username}`;
    }),
  );
}

function shouldRespondInChat(message: TelegramMessage) {
  if (!isGroupChat(message)) return true;
  const username = botUsername();
  const text = message.text ?? message.caption ?? "";
  const entities = message.text ? message.entities : message.caption_entities;
  const repliedToBot = username && message.reply_to_message?.from?.username?.toLowerCase() === username;
  return Boolean(repliedToBot || isMentioned(text, entities));
}

function stripBotMention(text: string) {
  const username = botUsername();
  if (!username) return text.trim();
  return text.replace(new RegExp(`@${username}\\b`, "gi"), "").trim();
}

async function telegramApi(method: string, body: Record<string, unknown>) {
  const token = botToken();
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not configured");
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Telegram ${method} failed`);
  return response.json();
}

async function sendTelegramMessage(chatId: number | string, text: string) {
  return telegramApi("sendMessage", {
    chat_id: chatId,
    text,
    disable_web_page_preview: true,
  });
}

async function downloadTelegramFile(fileId: string) {
  const token = botToken();
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not configured");
  const fileResponse = await telegramApi("getFile", { file_id: fileId });
  const filePath = fileResponse.result?.file_path;
  if (!filePath) throw new Error("Telegram file_path missing");
  const download = await fetch(`https://api.telegram.org/file/bot${token}/${filePath}`);
  if (!download.ok) throw new Error("Telegram file download failed");
  return new File([await download.blob()], filePath.split("/").at(-1) ?? "telegram-audio.oga", {
    type: download.headers.get("content-type") ?? "audio/ogg",
  });
}

async function transcribeTelegramAudio(file: File) {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not configured");
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const transcription = await client.audio.transcriptions.create({
    file,
    model: process.env.OPENAI_TRANSCRIBE_MODEL ?? "gpt-4o-mini-transcribe",
  });
  return transcription.text;
}

async function runTinyAgent(request: NextRequest, message: TelegramMessage, text: string) {
  const state = await getTinyState();
  const childId = process.env.TELEGRAM_DEFAULT_CHILD_ID ?? state.profile.id;
  const url = new URL("/api/ai/agent", request.url);
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text,
      childId,
      profile: { ...state.profile, id: childId, name: process.env.TELEGRAM_DEFAULT_CHILD_NAME ?? state.profile.name },
      todayEvents: state.events,
      recentEvents: state.events,
      memories: state.memories,
      supplies: state.supplies,
      source: "telegram",
      sender: message.from?.username ?? message.from?.first_name ?? String(message.from?.id ?? message.chat.id),
      externalChatId: String(message.chat.id),
      nowIso: message.date ? new Date(message.date * 1000).toISOString() : new Date().toISOString(),
    }),
  });
  if (!response.ok) throw new Error("Tiny agent route failed");
  return response.json();
}

async function persistTelegramTurn(message: TelegramMessage, text: string, agent: any) {
  const childId = process.env.TELEGRAM_DEFAULT_CHILD_ID ?? "emma";
  const sender = message.from?.username ?? message.from?.first_name ?? String(message.from?.id ?? message.chat.id);
  const createdAt = message.date ? new Date(message.date * 1000).toISOString() : new Date().toISOString();
  const userMessage: TinyConversationMessage = {
    id: crypto.randomUUID(),
    childId,
    source: "telegram",
    role: "user",
    text,
    sender,
    externalChatId: String(message.chat.id),
    createdAt,
  };
  const assistantMessage: TinyConversationMessage = {
    id: crypto.randomUUID(),
    childId,
    source: "telegram",
    role: "assistant",
    text: agent.message ?? "Got it.",
    externalChatId: String(message.chat.id),
    createdAt: new Date().toISOString(),
  };

  await appendConversation(userMessage);
  if (Array.isArray(agent.events) && agent.events.length) {
    const state = await appendEvents(agent.events as CareEvent[]);
    const candidates = detectMemoryCandidates(state.profile, state.events, state.supplies, state.memories);
    for (const memory of candidates) {
      await upsertStoredMemory(memory);
    }
  }
  await appendConversation(assistantMessage);
}

export async function POST(request: NextRequest) {
  const token = botToken();
  if (!token) {
    return NextResponse.json({ error: "TELEGRAM_BOT_TOKEN is not configured" }, { status: 500 });
  }

  const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const actualSecret = request.headers.get("x-telegram-bot-api-secret-token");
  if (expectedSecret && actualSecret !== expectedSecret) {
    return NextResponse.json({ error: "Invalid Telegram webhook secret" }, { status: 401 });
  }

  const update = (await request.json()) as TelegramUpdate;
  const message = update.message;
  if (!message) return NextResponse.json({ ok: true });

  const chatId = message.chat.id;
  if (!isAllowedSender(message)) {
    return NextResponse.json({ ok: true, ignored: "sender_not_allowed" });
  }

  if (!shouldRespondInChat(message)) {
    return NextResponse.json({ ok: true, ignored: "group_message_without_mention" });
  }

  try {
    let text = stripBotMention((message.text ?? message.caption ?? "").trim());
    if (text === "/start") {
      await sendTelegramMessage(chatId, "Hi, I'm Tiny. Send me messy care updates or voice notes about Emma, and I'll sort them into memory.");
      return NextResponse.json({ ok: true, mode: "start" });
    }

    if (!text && (message.voice?.file_id || message.audio?.file_id)) {
      await sendTelegramMessage(chatId, "Listening to that voice note...");
      const file = await downloadTelegramFile(message.voice?.file_id ?? message.audio!.file_id);
      text = await transcribeTelegramAudio(file);
    }

    if (!text) {
      await sendTelegramMessage(chatId, "Send me a note or voice message about Emma, and I'll sort it out.");
      return NextResponse.json({ ok: true });
    }

    const agent = await runTinyAgent(request, message, text);
    await persistTelegramTurn(message, text, agent);
    const eventsCount = Array.isArray(agent.events) ? agent.events.length : 0;
    const link = `${dashboardUrl()}/`;
    const storageNote = eventsCount
      ? `\n\nI understood ${eventsCount} care update${eventsCount === 1 ? "" : "s"}. Dashboard: ${link}`
      : `\n\nDashboard: ${link}`;

    await sendTelegramMessage(chatId, `${agent.message ?? "Got it."}${storageNote}`);
    return NextResponse.json({ ok: true, mode: agent.mode, eventsCount });
  } catch (error) {
    console.error("Telegram webhook failed", error);
    await sendTelegramMessage(chatId, "I hit a snag with that message. Try again in a moment.");
    return NextResponse.json({ ok: true });
  }
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    configured: Boolean(botToken()),
    note: "Use Telegram setWebhook to point your bot at /api/telegram/webhook.",
  });
}
