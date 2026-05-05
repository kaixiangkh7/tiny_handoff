import { NextResponse } from "next/server";
import { getTinyState } from "@/lib/server/tinyStore";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(await getTinyState());
}
