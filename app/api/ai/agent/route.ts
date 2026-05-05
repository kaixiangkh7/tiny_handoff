import OpenAI from "openai";
import { NextRequest, NextResponse } from "next/server";
import { CareEvent, TinyInboundMessage } from "@/lib/types";
import { parseNaturalCareEntry } from "@/lib/utils";

export const runtime = "nodejs";

const model = process.env.OPENAI_MODEL ?? "gpt-5.5";

const agentSchema = {
  name: "tiny_handoff_agent_turn",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      mode: { type: "string", enum: ["log", "ask", "clarify"] },
      message: { type: "string" },
      events: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            type: {
              type: "string",
              enum: ["wake", "nap_start", "nap_end", "meal", "milk", "water", "poop", "diaper", "medicine", "mood", "symptom", "supply", "note", "bedtime"],
            },
            timestamp: { type: "string" },
            amount: { anyOf: [{ type: "number" }, { type: "null" }] },
            unit: { anyOf: [{ type: "string" }, { type: "null" }] },
            status: { anyOf: [{ type: "string" }, { type: "null" }] },
            mood: { anyOf: [{ type: "string", enum: ["happy", "tired", "clingy", "fussy", "sick", "energetic"] }, { type: "null" }] },
            note: { anyOf: [{ type: "string" }, { type: "null" }] },
          },
          required: ["type", "timestamp", "amount", "unit", "status", "mood", "note"],
        },
      },
      askQuestion: { type: "string" },
    },
    required: ["mode", "message", "events", "askQuestion"],
  },
};

function localAgent(text: string, childId: string) {
  const lower = text.toLowerCase().trim();
  const soundsLikeQuestion = lower.includes("?") || /^(what|when|should|can|could|why|how|any|is|do|does)\b/.test(lower);
  const vagueLog = /^(milk|water|poop|nap|meal|medicine|mood|bedtime)$/i.test(lower);
  if (vagueLog) {
    return {
      mode: "clarify",
      message: `I can save that. What should I remember about ${text}? A rough amount, time, or quick detail is enough.`,
      events: [],
      askQuestion: "",
    };
  }
  if (soundsLikeQuestion) {
    return { mode: "ask", message: "Let me check Emma's care memory.", events: [], askQuestion: text };
  }
  return {
    mode: "log",
    message: "Got it. I sorted that into Emma's care memory.",
    events: parseNaturalCareEntry(text, childId),
    askQuestion: "",
  };
}

export async function POST(request: NextRequest) {
  const payload = await request.json();
  const { text, childId } = payload;
  if (!text || !childId) return NextResponse.json({ error: "Missing text or childId" }, { status: 400 });
  const inbound: TinyInboundMessage = {
    source: payload.source ?? "web",
    childId,
    sender: payload.sender,
    messageText: text,
    audioUrl: payload.audioUrl,
    timestamp: payload.nowIso,
  };

  const guarded = localAgent(text, childId);
  if (guarded.mode === "clarify") {
    return NextResponse.json({ ...guarded, source: "clarification-rule" });
  }

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ ...guarded, source: "local-rules" });
  }

  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const response = await client.responses.create({
      model,
      input: [
        {
          role: "system",
          content:
            "You are Tiny, a warm care-memory friend for busy parents. Parents do not need perfect logging. They may send one messy text or voice note with many things at once, like they are texting a friend. Your job is to sort it quietly into Emma's care memory. Decide whether the parent is giving care information to remember, asking a question, or saying something too ambiguous to act on. If logging, extract every clear care detail into structured CareEvent objects, and save partial information when safe rather than blocking. Ask a clarification only when the missing detail is important for safety, meaning, or action. If asking, set mode ask and put the cleaned question in askQuestion. Reply conversationally, concise, and reassuring. Avoid making the parent feel behind. Do not diagnose medical issues. Preserve details in notes. Use ISO timestamps; if no time is provided for a log, use nowIso.",
        },
        { role: "user", content: JSON.stringify({ ...payload, inbound }) },
      ],
      text: { format: { type: "json_schema", ...agentSchema } },
    } as any);

    const parsed = JSON.parse(response.output_text);
    const now = new Date().toISOString();
    const events: CareEvent[] = parsed.events.map((event: any) => ({
      id: crypto.randomUUID(),
      childId,
      type: event.type,
      timestamp: event.timestamp,
      amount: event.amount ?? undefined,
      unit: event.unit ?? undefined,
      status: event.status ?? undefined,
      mood: event.mood ?? undefined,
      note: event.note ?? text,
      createdAt: now,
      updatedAt: now,
    }));

    return NextResponse.json({ ...parsed, events, source: "openai-agent" });
  } catch (error) {
    console.error("AI agent failed", error);
    return NextResponse.json({ ...localAgent(text, childId), source: "local-rules-fallback" });
  }
}
