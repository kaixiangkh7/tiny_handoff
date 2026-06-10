import OpenAI from "openai";
import { NextRequest, NextResponse } from "next/server";
import { appendConversation, appendEvents, getTinyState, upsertStoredMemory } from "@/lib/server/tinyStore";
import { CareEvent, TinyConversationMessage } from "@/lib/types";
import { detectMemoryCandidates } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const model = process.env.OPENAI_MODEL ?? "gpt-5.5";

function cleanTinyReply(value: string) {
  return value
    .replace(/#{1,6}\s*/g, "")
    .replace(/\*\*/g, "")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function recentThread(conversations: TinyConversationMessage[]) {
  return conversations
    .filter((message) => message.source === "telegram" || message.source === "web")
    .slice(-10)
    .map((message) => ({ role: message.role, source: message.source, text: message.text, at: message.createdAt }));
}

async function runAgent(request: NextRequest, payload: any, state: Awaited<ReturnType<typeof getTinyState>>) {
  const childId = payload.childId ?? state.profile.id;
  const response = await fetch(new URL("/api/ai/agent", request.url), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...payload,
      childId,
      profile: payload.profile ?? state.profile,
      todayEvents: state.events,
      recentEvents: state.events,
      memories: state.memories,
      supplies: state.supplies,
      source: "web",
      nowIso: new Date().toISOString(),
    }),
  });
  if (!response.ok) throw new Error("Tiny agent route failed");
  return response.json();
}

async function composeReply(text: string, agent: any, state: Awaited<ReturnType<typeof getTinyState>>) {
  const fallback = cleanTinyReply(agent.message ?? "I’m here with you.");
  if (!process.env.OPENAI_API_KEY) return fallback;

  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const response = await client.responses.create({
      model,
      input: [
        {
          role: "system",
          content:
            "You are Tiny, a warm friend and practical guide for a parent caring for Emma. This is the in-app Talk entry, and it should feel exactly like the Telegram bot. Logging happens silently in the backend; do not mention logging, saving, care updates, dashboards, or memory unless the parent asks. Respond to the newest message using the recent thread, today's events, symptoms, fluids, poop, sleep, and supplies. If the message is a short continuation, infer the context. Be natural, specific, and proactive, like a thoughtful friend. Keep it concise, usually 1-2 short paragraphs. For medical topics, avoid diagnosis and include clear red flags only when relevant.",
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
            recentThread: recentThread(state.conversations),
            todayEvents: state.events.slice(-30),
            supplies: state.supplies,
            memories: state.memories,
          }),
        },
      ],
    } as any);

    return cleanTinyReply(response.output_text || fallback);
  } catch (error) {
    console.error("Web turn reply composer failed", error);
    return fallback;
  }
}

async function persistWebTurn(text: string, agent: any, replyText: string, state: Awaited<ReturnType<typeof getTinyState>>, childId: string) {
  await appendConversation({
    id: crypto.randomUUID(),
    childId,
    source: "web",
    role: "user",
    text,
    sender: "app",
    createdAt: new Date().toISOString(),
  });

  let nextState = state;
  if (Array.isArray(agent.events) && agent.events.length) {
    nextState = await appendEvents(agent.events as CareEvent[]);
    const candidates = detectMemoryCandidates(nextState.profile, nextState.events, nextState.supplies, nextState.memories);
    for (const memory of candidates) {
      nextState = await upsertStoredMemory(memory);
    }
  }

  nextState = await appendConversation({
    id: crypto.randomUUID(),
    childId,
    source: "web",
    role: "assistant",
    text: replyText,
    createdAt: new Date().toISOString(),
  });

  return nextState;
}

export async function POST(request: NextRequest) {
  const payload = await request.json();
  const text = String(payload.text ?? "").trim();
  if (!text) return NextResponse.json({ error: "Missing text" }, { status: 400 });

  const state = await getTinyState();
  const childId = payload.childId ?? state.profile.id;
  const agent = await runAgent(request, { ...payload, text, childId }, state);
  const replyText = await composeReply(text, agent, state);
  const nextState = await persistWebTurn(text, agent, replyText, state, childId);

  return NextResponse.json({
    mode: agent.mode,
    message: replyText,
    events: agent.events ?? [],
    source: "web-turn",
    state: nextState,
  });
}
