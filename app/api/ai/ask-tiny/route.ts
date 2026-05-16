import OpenAI from "openai";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const model = process.env.OPENAI_MODEL ?? "gpt-5.5";

const sourceDomains = [
  "healthychildren.org",
  "cdc.gov",
  "nhs.uk",
  "mayoclinic.org",
  "reddit.com",
  "babycenter.com",
  "whattoexpect.com",
  "mumsnet.com",
];

function fallbackChat(question: string) {
  const lower = question.toLowerCase();
  if (/^hey|^hi|^hello/.test(lower)) return "Hey. What's going on?";
  if (/fell asleep|fall asleep|asleep|sleeping/.test(lower)) return "Aww, good. Hope she gets a solid stretch.";
  if (/fine|nothing to worry|all good|seems okay|seems ok/.test(lower)) return "Good. Then I'd just let the day stay boring and easy.";
  if (/cry|cried|upset|rough/.test(lower)) return "Oh no. That sounds stressful. Tell me what happened.";
  if (/what do you mean|huh|confused|don't understand/.test(lower)) return "I mean: I'm here to talk it through with you, and I'll quietly keep the care log updated in the background.";
  return "Got it. I'm here.";
}

export async function POST(request: NextRequest) {
  const payload = await request.json();
  const question = String(payload.question ?? "");
  const wantsResearch = /\b(source|sources|research|internet|forum|forums|reddit|doctor|pediatrician|medical|urgent|fever|blood|vomit|dehydrat|breathing|letharg)\b/i.test(
    `${question} ${payload.intent ?? ""}`,
  );
  const hasConcern = /\b(worry|worried|concern|concerned|is this ok|is this okay|should i|help|cry|cried|pain|rash|fever|blood|vomit|dehydrat|breathing|letharg|urgent|doctor|pediatrician|sick|not eating|won't eat|refusing)\b/i.test(
    question,
  );

  const memoryInput =
    Array.isArray(payload.memoryContext) && payload.memoryContext.length
      ? [
          {
            role: "user",
            content: `Older conversation memory, for context only:\n${payload.memoryContext.map((memory: any) => `- ${memory.statement}`).join("\n")}`,
          },
        ]
      : [];

  const conversationInput = Array.isArray(payload.conversationContext)
    ? payload.conversationContext.slice(-10).map((message: any) => ({
        role: message.role === "assistant" ? "assistant" : "user",
        content: String(message.text ?? ""),
      }))
    : [];

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ answer: fallbackChat(question), source: "not-configured" }, { status: 200 });
  }

  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const response = await client.responses.create({
      model,
      tools: wantsResearch
        ? [
            {
              type: "web_search",
              search_context_size: "low",
              filters: { allowed_domains: sourceDomains },
            },
          ]
        : [],
      tool_choice: "auto",
      include: wantsResearch ? ["web_search_call.action.sources"] : [],
      reasoning: { effort: "low" },
      text: { verbosity: "low" },
      input: [
        {
          role: "developer",
          content: hasConcern
            ? "Reply as Tiny: calm, warm, and practical. Be empathetic first. If the user mentions a real concern or red-flag symptom, include a brief safety note, but do not sound clinical or list every possible warning sign."
            : "Reply as Tiny: calm, warm, casual, and brief. Do not add medical caveats, red-flag lists, or 'seek help' language when the user is not asking about a concern. For simple updates, respond like a kind friend in one or two short sentences.",
        },
        ...memoryInput,
        ...conversationInput,
        {
          role: "user",
          content: question,
        },
      ],
    } as any);

    return NextResponse.json({ answer: response.output_text, source: wantsResearch ? "openai-web" : "openai-chat" });
  } catch (error) {
    console.error("AI ask failed", error);
    return NextResponse.json({ answer: fallbackChat(question), source: "openai-error" }, { status: 200 });
  }
}
