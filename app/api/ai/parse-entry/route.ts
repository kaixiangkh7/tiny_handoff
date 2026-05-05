import OpenAI from "openai";
import { NextRequest, NextResponse } from "next/server";
import { parseNaturalCareEntry } from "@/lib/utils";

export const runtime = "nodejs";

const model = process.env.OPENAI_MODEL ?? "gpt-5.5";

const eventSchema = {
  name: "tiny_handoff_events",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
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
    },
    required: ["events"],
  },
};

export async function POST(request: NextRequest) {
  const { text, childId, nowIso } = await request.json();
  if (!text || !childId) return NextResponse.json({ error: "Missing text or childId" }, { status: 400 });

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ events: parseNaturalCareEntry(text, childId), source: "local-rules" });
  }

  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const response = await client.responses.create({
      model,
      input: [
        {
          role: "system",
          content:
            "You convert one messy parent/caregiver note into childcare log events. Preserve the user's note. Infer event types conservatively. Use ISO timestamps for today when the user gives a time. If a time is missing, use nowIso. Do not give advice.",
        },
        {
          role: "user",
          content: JSON.stringify({ text, childId, nowIso: nowIso ?? new Date().toISOString() }),
        },
      ],
      text: { format: { type: "json_schema", ...eventSchema } },
    } as any);

    const parsed = JSON.parse(response.output_text);
    const now = new Date().toISOString();
    const events = parsed.events.map((event: any) => ({
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

    return NextResponse.json({ events, source: "openai" });
  } catch (error) {
    console.error("AI parse failed", error);
    return NextResponse.json({ events: parseNaturalCareEntry(text, childId), source: "local-rules-fallback" });
  }
}
