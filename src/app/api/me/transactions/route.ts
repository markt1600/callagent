import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { listJSON } from "@/lib/store";
import type { CreditTransaction } from "@/lib/types";

export const runtime = "nodejs";

/** The signed-in user's credit ledger, newest first. */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ transactions: [] });
  const transactions = await listJSON<CreditTransaction>(`credtx:${user.id}:`);
  transactions.sort((a, b) => b.at.localeCompare(a.at));
  return NextResponse.json({ transactions: transactions.slice(0, 200) });
}
