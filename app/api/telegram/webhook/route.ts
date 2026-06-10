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
const openaiModel = () => process.env.OPENAI_MODEL ?? "gpt-5.5";

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

async function persistTelegramTurn(message: TelegramMessage, text: string, agent: any, assistantText?: string) {
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
    text: assistantText ?? agent.message ?? "I’ll remember that.",
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

function cleanReceiptLanguage(message: string) {
  return message
    .replace(/^got it[.!—\-\s]*/i, "")
    .replace(/^i(?:'|’)ll note that\s*/i, "I’ll remember that ")
    .replace(/^i logged that\s*/i, "I’ll remember that ")
    .replace(/^i noted that\s*/i, "I’ll remember that ")
    .trim();
}

function includesAny(value: string, words: string[]) {
  const lower = value.toLowerCase();
  return words.some((word) => lower.includes(word));
}

function describeSavedEvent(event: CareEvent) {
  if (event.type === "poop") {
    const status = event.status ? ` ${event.status}` : "";
    return `poop${status}`.trim();
  }
  if (event.type === "water") return "water";
  if (event.type === "mood") return event.mood ?? event.status ?? "mood";
  if (event.type === "symptom") return event.status ?? "symptoms";
  if (event.type === "bedtime") return event.status === "asleep" ? "sleep" : "bedtime";
  return event.type.replaceAll("_", " ");
}

function recentThreadText(conversations: TinyConversationMessage[]) {
  return conversations
    .filter((message) => message.source === "telegram")
    .slice(-8)
    .map((message) => message.text)
    .join(" ")
    .toLowerCase();
}

function recentThreadForReply(conversations: TinyConversationMessage[]) {
  return conversations
    .filter((message) => message.source === "telegram")
    .slice(-10)
    .map((message) => ({
      role: message.role,
      text: message.text,
      at: message.createdAt,
    }));
}

function buildFriendlyLogReply(text: string, events: CareEvent[], fallback: string, recentContext = "") {
  const lower = text.toLowerCase();
  const context = `${recentContext} ${lower}`;
  const eventTypes = new Set(events.map((event) => event.type));
  const eventWords = events.map(describeSavedEvent).filter(Boolean);
  const hasSickContext = includesAny(context, ["sick", "runny", "cold", "nose", "cried", "cry", "fever", "cough"]);

  if (includesAny(lower, ["don't have a humidifier", "dont have a humidifier", "no humidifier", "do not have a humidifier"])) {
    return "Totally okay. Emma does not need perfect gear tonight. If you do not have a humidifier, you can skip it. If her nose is really bothering her, try saline drops or spray, gentle suction, holding her a bit upright while she settles, or sitting with her in a steamy bathroom for a few minutes. The main thing is comfort and watching her breathing.";
  }

  if (includesAny(lower, ["don't have", "dont have", "do not have", "no "]) && hasSickContext) {
    return "That is okay. Work with what you have tonight. For a runny nose, the basics still help: keep her comfortable, offer small sips if she wakes, use saline if you have it, and watch that her breathing stays easy.";
  }

  if (eventTypes.has("poop")) {
    const poop = events.find((event) => event.type === "poop");
    const status = poop?.status ? ` ${poop.status}` : "";
    return `Ah, that helps. Half hard and half soft sounds like things may be moving, even if her belly is not totally back to easy yet. I would keep fluids gentle when she is awake and just watch whether the next poop keeps softening.`;
  }

  if (eventTypes.has("water")) {
    return hasSickContext || includesAny(lower, ["not much", "didn't drink", "did not drink"])
      ? "That fits with the night you are having. I would not wake her just for water, but if she stirs or wakes up, offer a few small sips. With the harder poop earlier, little chances for fluids tomorrow matter more than forcing anything tonight."
      : "Good to know. If she is happy and awake later, a few sips are enough; no need to turn it into a big task.";
  }

  if (eventTypes.has("symptom") || eventTypes.has("mood")) {
    return hasSickContext
      ? "Poor little Emma. If she is asleep and breathing comfortably, this still sounds like a watch-and-comfort night. You do not need to keep doing things just to do something; quiet checks are enough unless something changes."
      : `That gives the next caregiver a little more context. ${eventWords.length ? `The useful bit is ${eventWords.join(", ")}.` : ""}`.trim();
  }

  if (eventTypes.has("bedtime")) {
    return "Aww, I am glad she got to sleep. Since she is already down, the best next move is probably doing less: keep it quiet, check gently, and let her rest if her breathing looks comfortable.";
  }

  const cleaned = cleanReceiptLanguage(fallback);
  if (cleaned && !/^got it/i.test(cleaned)) return cleaned;
  return hasSickContext
    ? "That makes sense in the bigger picture tonight. Keep the plan simple: comfort, fluids if she wakes, and watching for anything that feels truly off."
    : eventWords.length
      ? `That helps round out the picture: ${eventWords.join(", ")}.`
      : "That makes sense. I’m with you.";
}

function fallbackTelegramReply(text: string, agent: any, recentConversations: TinyConversationMessage[]) {
  const events = Array.isArray(agent.events) ? (agent.events as CareEvent[]) : [];
  const context = recentThreadText(recentConversations);

  if (agent.mode === "clarify") {
    return cleanReceiptLanguage(agent.message ?? "Can you tell me one more detail?");
  }

  if (agent.mode === "ask") {
    return cleanReceiptLanguage(agent.message ?? "Let me think that through with Emma’s recent notes.");
  }

  return buildFriendlyLogReply(text, events, agent.message ?? "", context);
}

async function buildTelegramReply(text: string, agent: any, recentConversations: TinyConversationMessage[]) {
  const fallback = fallbackTelegramReply(text, agent, recentConversations);
  if (!process.env.OPENAI_API_KEY) return fallback;

  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const response = await client.responses.create({
      model: openaiModel(),
      input: [
        {
          role: "system",
          content:
            "You are Tiny, a warm friend and practical guide for a parent caring for Emma. You are not a logging bot. The backend may save events silently, but your reply should not mention logging, saving, care updates, dashboards, or memory unless the parent asks. Respond to the emotional and practical situation in the most recent message, using the recent thread for context. If the newest message is a short continuation like 'again' or 'don't have a humidifier', infer what it refers to from the thread. Do not repeat the same answer twice. Be natural, specific, and proactive, like a thoughtful friend. Keep it concise: usually 1-2 short paragraphs. For medical topics, avoid diagnosis; give comfort steps and clear red flags when relevant. If one detail is genuinely needed before you can help safely, ask one gentle clarifying question.",
        },
        {
          role: "user",
          content: JSON.stringify({
            newestMessage: text,
            agentMode: agent.mode,
            extractedEvents: Array.isArray(agent.events)
              ? agent.events.map((event: CareEvent) => ({
                  type: event.type,
                  status: event.status,
                  mood: event.mood,
                  note: event.note,
                  timestamp: event.timestamp,
                }))
              : [],
            agentDraft: agent.message ?? "",
            fallbackDraft: fallback,
            recentThread: recentThreadForReply(recentConversations),
          }),
        },
      ],
    } as any);

    const reply = response.output_text?.trim();
    if (!reply) return fallback;
    return reply
      .replace(/\n{3,}/g, "\n\n")
      .replace(/dashboard:\s*https?:\/\/\S+/gi, "")
      .replace(/saved quietly here:\s*https?:\/\/\S+/gi, "")
      .trim();
  } catch (error) {
    console.error("Telegram reply composer failed", error);
    return fallback;
  }
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
    const eventsCount = Array.isArray(agent.events) ? agent.events.length : 0;
    const stateForReply = await getTinyState();
    const replyText = await buildTelegramReply(text, agent, stateForReply.conversations);
    await persistTelegramTurn(message, text, agent, replyText);
    await sendTelegramMessage(chatId, replyText);
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
