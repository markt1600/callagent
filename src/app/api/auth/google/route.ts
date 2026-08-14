import { NextRequest, NextResponse } from "next/server";
import { authConfigured, setSessionCookie, verifyGoogleCredential } from "@/lib/auth";
import { getJSON, setJSON } from "@/lib/store";
import type { UserProfile } from "@/lib/types";

export const runtime = "nodejs";

/** Exchange a Google ID token for a session cookie, creating the profile on first login. */
export async function POST(request: NextRequest) {
  try {
    if (!authConfigured()) {
      return NextResponse.json(
        { error: "Google login is not configured (NEXT_PUBLIC_GOOGLE_CLIENT_ID / AUTH_SECRET)" },
        { status: 501 },
      );
    }
    const { credential } = await request.json();
    if (typeof credential !== "string" || !credential) {
      return NextResponse.json({ error: "Missing credential" }, { status: 400 });
    }

    const identity = await verifyGoogleCredential(credential);
    const key = `user:${identity.sub}`;
    let user = await getJSON<UserProfile>(key);
    const firstLogin = !user;
    if (!user) {
      user = {
        id: identity.sub,
        email: identity.email,
        name: identity.name,
        picture: identity.picture,
        // A Google display name usually has first + last, which is exactly
        // what the booking-name field requires — seed it when it qualifies.
        bookingName:
          identity.name && identity.name.trim().split(/\s+/).length >= 2
            ? identity.name.trim()
            : undefined,
        createdAt: new Date().toISOString(),
      };
    } else {
      user.email = identity.email;
      user.name = identity.name;
      user.picture = identity.picture;
    }
    await setJSON(key, user);
    await setSessionCookie(user.id);
    return NextResponse.json({ user, firstLogin });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 401 });
  }
}
