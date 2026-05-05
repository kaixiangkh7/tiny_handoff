import { NextRequest, NextResponse } from "next/server";
import { saveStoredSupplies } from "@/lib/server/tinyStore";
import { SupplyItem } from "@/lib/types";

export const runtime = "nodejs";

export async function PUT(request: NextRequest) {
  const { supplies } = (await request.json()) as { supplies?: SupplyItem[] };
  if (!supplies) return NextResponse.json({ error: "Missing supplies" }, { status: 400 });
  return NextResponse.json(await saveStoredSupplies(supplies));
}
