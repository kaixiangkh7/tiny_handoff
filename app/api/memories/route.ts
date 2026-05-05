import { NextRequest, NextResponse } from "next/server";
import { deleteStoredMemory, upsertStoredMemory } from "@/lib/server/tinyStore";
import { ChildMemory } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const { memory } = (await request.json()) as { memory?: ChildMemory };
  if (!memory) return NextResponse.json({ error: "Missing memory" }, { status: 400 });
  return NextResponse.json(await upsertStoredMemory(memory));
}

export async function PUT(request: NextRequest) {
  return POST(request);
}

export async function DELETE(request: NextRequest) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
  return NextResponse.json(await deleteStoredMemory(id));
}
