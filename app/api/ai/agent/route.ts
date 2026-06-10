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
      mode: { type: "string", enum: ["log", "ask", "clarify", "care_moment"] },
      message: { type: "string" },
      safetyLevel: { type: "string", enum: ["normal", "watch", "call_pediatrician", "urgent"] },
      nextSteps: { type: "array", items: { type: "string" } },
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
    required: ["mode", "message", "safetyLevel", "nextSteps", "events", "askQuestion"],
  },
};

function hasRecentPoopConcern(payload: any) {
  const recentEvents = Array.isArray(payload.recentEvents) ? payload.recentEvents : [];
  const memories = Array.isArray(payload.memories) ? payload.memories : [];
  return (
    recentEvents.some(
      (event: any) =>
        event?.type === "poop" &&
        (String(event.status ?? "").match(/hard|constipat/i) || String(event.note ?? "").match(/hard|constipat|cried|strain|pain/i)),
    ) ||
    memories.some(
      (memory: any) =>
        memory?.type === "poop_pattern" || String(memory?.statement ?? "").match(/hard poop|constipat|stool/i),
    )
  );
}

function needsPoopClarification(text: string, payload: any) {
  const lower = text.toLowerCase();
  const mentionsPoop = /\b(poop|pooped|stool|bm)\b/.test(lower);
  if (!mentionsPoop || !hasRecentPoopConcern(payload)) return false;

  const mentionsFrequencyOnly = /\b(twice|two times|2 times|once|one time|\d+\s*(x|times?)|a couple)\b/.test(lower);
  const hasShape = /\b(hard|soft|normal|watery|loose|diarrhea|formed|pellet|pebble|mushy)\b/.test(lower);
  const hasSpecificTime = /\b(\d{1,2})(?::\d{2})?\s*(am|pm)?\b|\b(morning|afternoon|evening|tonight|after|before|around)\b/.test(lower);

  return mentionsFrequencyOnly && (!hasShape || !hasSpecificTime);
}

function localAgent(text: string, childId: string, payload: any = {}) {
  const lower = text.toLowerCase().trim();
  const soundsLikeQuestion = lower.includes("?") || /^(what|when|should|can|could|why|how|any|is|do|does)\b/.test(lower);
  const hasCareDetails = /\b(cry|cried|diaper|poop|stool|bm|wet|yellow|rash|fever|vomit|blood|milk|water|nap|meal|medicine|changed)\b/.test(lower);
  const serious = /\b(blood|breathing|blue|dehydrat|letharg|limp|repeated vomit|fever|severe pain)\b/.test(lower);
  const vagueLog = /^(milk|water|poop|nap|meal|medicine|mood|bedtime)$/i.test(lower);
  if (needsPoopClarification(text, payload)) {
    return {
      mode: "clarify",
      message:
        "Ah, that poop detail is actually useful because of the constipation stuff from earlier. Do you remember roughly when the two poops happened, and were they hard, soft, normal, watery, or was she straining/crying?",
      events: [],
      askQuestion: "",
    };
  }
  if (vagueLog) {
    return {
      mode: "clarify",
      message: `Ok, what should I know about ${text}? A rough amount, time, or quick detail is enough.`,
      safetyLevel: "normal",
      nextSteps: [],
      events: [],
      askQuestion: "",
    };
  }
  if (soundsLikeQuestion && hasCareDetails) {
    const events = parseNaturalCareEntry(text, childId);
    return {
      mode: "care_moment",
      message: serious
        ? "Ok, I see. Because you mentioned a potentially concerning symptom, contact your pediatrician or urgent care depending on severity. If Emma has trouble breathing, seems dehydrated, unusually lethargic, or symptoms feel severe, seek urgent care now."
        : "Ok, I see. Poor Emma. Wet yellow poop can happen, but focus on comfort first: check diaper fit and rash, soothe her, offer fluids if appropriate, and watch whether she settles. If there is blood, fever, repeated vomiting, dehydration signs, severe pain, or she seems unusually lethargic, contact your pediatrician or urgent care.",
      safetyLevel: serious ? "urgent" : "watch",
      nextSteps: serious
        ? ["Contact a medical professional based on severity.", "Keep notes on timing, stool, crying, temperature, and fluids."]
        : ["Check diaper fit and skin for rash.", "Comfort her and watch if she settles.", "Track fever, blood, vomiting, dehydration, or worsening pain."],
      events,
      askQuestion: "",
    };
  }
  if (soundsLikeQuestion) {
    return { mode: "ask", message: "Let me check Emma's care memory.", safetyLevel: "normal", nextSteps: [], events: [], askQuestion: text };
  }
  return {
    mode: "log",
    message: "",
    safetyLevel: "normal",
    nextSteps: [],
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

  const guarded = localAgent(text, childId, payload);
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
            "You are Tiny's structured childcare note extractor. This is an internal backend step, not the parent-facing chat. Classify the current inbound.messageText as log, ask, clarify, or care_moment. Use conversationContext only to resolve follow-ups and pronouns. Extract CareEvent objects only from inbound.messageText, never from todayEvents, recentEvents, memories, ruleAnswer, conversationContext, or any other context. Parents may send messy text or voice notes with many things at once; extract every clear care detail and save partial information when safe rather than blocking. If the current message has care facts plus a question or concern, set mode care_moment and extract clear events. If it is only care facts, set mode log and extract events. If it is only a question, set mode ask, put the cleaned context-aware question in askQuestion, and return an empty events array. Ask clarification only when missing detail is important for safety, meaning, or action. If the parent mentions poop frequency but not time or stool quality, and recent events or memories mention constipation, hard poop, straining, crying, or poop concern, ask when it happened and what it looked like instead of logging a vague poop event. Do not diagnose. Use safetyLevel only for routing. Preserve color, texture, crying, and caregiver details in notes. Use ISO timestamps; if no time is provided, use nowIso. Keep message empty unless mode is clarify.",
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
    return NextResponse.json({ ...localAgent(text, childId, payload), source: "local-rules-fallback" });
  }
}
