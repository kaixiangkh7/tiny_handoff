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

export async function POST(request: NextRequest) {
  const payload = await request.json();

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      {
        answer:
          payload.ruleAnswer ??
          "AI backend is not configured yet. Add OPENAI_API_KEY to use web-backed Ask Tiny. Local rule guidance is still available in the app.",
        source: "not-configured",
      },
      { status: 200 },
    );
  }

  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const response = await client.responses.create({
      model,
      tools: [
        {
          type: "web_search",
          search_context_size: "low",
          filters: { allowed_domains: sourceDomains },
        },
      ],
      tool_choice: "auto",
      include: ["web_search_call.action.sources"],
      reasoning: { effort: "low" },
      text: { verbosity: "low" },
      input: [
        {
          role: "system",
          content:
            "You are Tiny Handoff's childcare assistant inside a small mobile chat sheet. Keep replies very short: max 5 concise lines, no markdown headings, no raw URLs, no bullet nesting. Use plain text only. Combine the app's rule result with current web search. Parent forum posts are anecdotal only and never medical evidence. Prefer pediatric authority sources for safety/health claims. Do not diagnose. For blood, repeated severe pain, vomiting, fever, breathing problems, dehydration, lethargy, or other concerning symptoms, clearly recommend contacting a pediatrician or urgent care depending on severity. End with compact source names only, like 'Sources: CDC, Mayo Clinic'.",
        },
        {
          role: "user",
          content: JSON.stringify(payload),
        },
      ],
    } as any);

    return NextResponse.json({ answer: response.output_text, source: "openai-web" });
  } catch (error) {
    console.error("AI ask failed", error);
    return NextResponse.json(
      {
        answer:
          "The AI backend could not answer right now. Use the local rule result and consider checking with your pediatrician for health concerns.",
        source: "openai-error",
      },
      { status: 200 },
    );
  }
}
