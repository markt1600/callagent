import { NextResponse } from "next/server";
import { loadCall, backfillTranslations } from "@/lib/callEngine";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const call = await loadCall(id);
  if (!call) return NextResponse.json({ error: "Not found" }, { status: 404 });
  // Translate any restaurant turns lazily, off the hot call path.
  const updated = await backfillTranslations(call);
  return NextResponse.json({ call: updated });
}
