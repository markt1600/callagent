// Inspect the persistent phrase library (what's cached, hit counts).

import { NextResponse } from "next/server";
import { listLibrary } from "@/lib/phraseLibrary";

export const runtime = "nodejs";

export async function GET() {
  const entries = await listLibrary();
  const totalHits = entries.reduce((sum, e) => sum + e.hits, 0);
  return NextResponse.json({
    count: entries.length,
    totalHits,
    reuseRate: totalHits > 0 ? (totalHits - entries.length) / totalHits : 0,
    entries,
  });
}
