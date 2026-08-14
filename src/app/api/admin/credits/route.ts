// Admin: view and edit per-destination call credit costs.
// Keys are country prefixes ("+65", "+81") plus "default".

import { NextRequest, NextResponse } from "next/server";
import { requireAdminRequest } from "@/lib/auth";
import { getCreditCosts, setCreditCosts } from "@/lib/credits";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const denied = await requireAdminRequest(request);
  if (denied) return NextResponse.json({ error: denied }, { status: 401 });
  return NextResponse.json({ costs: await getCreditCosts() });
}

export async function POST(request: NextRequest) {
  const denied = await requireAdminRequest(request);
  if (denied) return NextResponse.json({ error: denied }, { status: 401 });
  const body = await request.json();
  if (!body.costs || typeof body.costs !== "object") {
    return NextResponse.json({ error: "Missing costs object" }, { status: 400 });
  }
  const costs = await setCreditCosts(body.costs as Record<string, unknown>);
  return NextResponse.json({ costs });
}
