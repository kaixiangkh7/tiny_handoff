import OpenAI from "openai";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const model = process.env.OPENAI_MODEL ?? "gpt-5.5";

const recommendationSchema = {
  name: "tiny_dashboard_recommendation",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      title: { type: "string" },
      detail: { type: "string" },
      timing: { type: "string" },
      tone: { type: "string", enum: ["primary", "normal", "warn"] },
    },
    required: ["title", "detail", "timing", "tone"],
  },
};

export async function POST(request: NextRequest) {
  const payload = await request.json();

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ recommendation: payload.fallbackStep, source: "not-configured" });
  }

  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const response = await client.responses.create({
      model,
      reasoning: { effort: "low" },
      text: { format: { type: "json_schema", ...recommendationSchema } },
      input: [
        {
          role: "system",
          content:
            "You write the single Recommendation card for Tiny Handoff's mobile dashboard. This card is not the empathy section; another card already gives the warm conversational read. Your job is to produce a distinct, action-oriented next move for right now. Be practical and specific, like a small care plan card. Do not repeat emotional reassurance from the conversation. Do not summarize the latest chat. Do not sound templated. Base the recommendation on the current clock, today's events, recent Telegram conversation, sleep state, symptoms, fluids, poop, and supplies. If the child is asleep at night, do not recommend meals, water, or poop tracking as immediate actions; mention fluids only if she wakes. If health symptoms are present, avoid diagnosis and include red flags only if they materially change the action. The title should be an imperative or concrete action, the timing should be 1-3 words, and the detail should be 1 concise sentence.",
        },
        {
          role: "user",
          content: JSON.stringify(payload),
        },
      ],
    } as any);

    return NextResponse.json({ recommendation: JSON.parse(response.output_text), source: "openai" });
  } catch (error) {
    console.error("AI recommendation failed", error);
    return NextResponse.json({ recommendation: payload.fallbackStep, source: "fallback" });
  }
}
