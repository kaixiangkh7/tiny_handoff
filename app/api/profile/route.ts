import { NextRequest, NextResponse } from "next/server";
import { saveStoredProfile } from "@/lib/server/tinyStore";
import { ChildProfile } from "@/lib/types";

export const runtime = "nodejs";

export async function PUT(request: NextRequest) {
  const { profile } = (await request.json()) as { profile?: ChildProfile };
  if (!profile?.id) return NextResponse.json({ error: "Missing profile" }, { status: 400 });
  return NextResponse.json(await saveStoredProfile(profile));
}
