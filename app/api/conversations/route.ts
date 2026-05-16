import { NextRequest, NextResponse } from "next/server";
import { appendConversation, clearStoredConversations } from "@/lib/server/tinyStore";
import { TinyConversationMessage } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const { message } = (await request.json()) as { message?: TinyConversationMessage };
  if (!message?.childId || !message.text?.trim()) {
    return NextResponse.json({ error: "Missing conversation message" }, { status: 400 });
  }

  return NextResponse.json(await appendConversation(message));
}

export async function DELETE(request: NextRequest) {
  const childId = request.nextUrl.searchParams.get("childId") ?? undefined;
  return NextResponse.json(await clearStoredConversations(childId));
}
