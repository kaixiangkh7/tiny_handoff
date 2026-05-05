import { NextRequest, NextResponse } from "next/server";
import { appendEvents, deleteStoredEvent } from "@/lib/server/tinyStore";
import { CareEvent } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const { events } = (await request.json()) as { events?: CareEvent[] };
  if (!events?.length) return NextResponse.json({ error: "Missing events" }, { status: 400 });
  return NextResponse.json(await appendEvents(events));
}

export async function DELETE(request: NextRequest) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
  return NextResponse.json(await deleteStoredEvent(id));
}
