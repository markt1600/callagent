// Google sign-in + session cookies.
//
// Flow: the client renders Google's "Sign in with Google" button (Google
// Identity Services). Google hands the browser an ID token (JWT), the
// browser posts it to /api/auth/google, we verify it with Google's
// tokeninfo endpoint, upsert the user profile in KV, and set an HMAC-signed
// httpOnly session cookie. Guest mode = no cookie; everything still works,
// nothing is associated with an account.

import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { getJSON } from "./store";
import type { UserProfile } from "./types";

const COOKIE_NAME = "am_session";
const SESSION_MAX_AGE_S = 60 * 60 * 24 * 90; // 90 days

function authSecret(): string {
  return process.env.AUTH_SECRET || "";
}

export function googleClientId(): string {
  return process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || "";
}

/** True when Google login is usable (client id + cookie-signing secret set). */
export function authConfigured(): boolean {
  return Boolean(authSecret() && googleClientId());
}

/** The one account allowed to use Admin (in addition to knowing the PIN). */
export function adminEmail(): string {
  return process.env.ADMIN_EMAIL || "markh.tan@gmail.com";
}

/** Is the current session the owner account? */
export async function isAdminUser(): Promise<boolean> {
  const user = await getSessionUser();
  return Boolean(user && user.email.toLowerCase() === adminEmail().toLowerCase());
}

/**
 * Guard for admin endpoints: valid PIN header AND (when Google login is
 * configured) an owner-account session. Returns an error message, or null
 * when access is allowed. Without auth configured it falls back to PIN-only
 * so the owner can't be locked out before setting up Google login.
 */
export async function requireAdminRequest(request: {
  headers: { get(name: string): string | null };
}): Promise<string | null> {
  const pin = request.headers.get("x-admin-pin");
  if (!process.env.ADMIN_PIN) return "Admin is disabled (ADMIN_PIN not set)";
  if (pin !== process.env.ADMIN_PIN) return "Invalid admin PIN";
  if (authConfigured() && !(await isAdminUser())) {
    return "Admin is restricted to the owner account — sign in with Google first";
  }
  return null;
}

// ------------------------------------------------------------------ sessions

function sign(data: string): string {
  return createHmac("sha256", authSecret()).update(data).digest("base64url");
}

/** Create a signed session token for a user id. */
export function sealSession(sub: string): string {
  const body = Buffer.from(
    JSON.stringify({ sub, exp: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_S }),
  ).toString("base64url");
  return `${body}.${sign(body)}`;
}

/** Verify a session token; returns the user id or null. */
export function openSession(token: string | undefined): string | null {
  if (!token || !authSecret()) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  try {
    const expected = sign(body);
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as {
      sub?: string;
      exp?: number;
    };
    if (!payload.sub || !payload.exp || payload.exp < Date.now() / 1000) return null;
    return payload.sub;
  } catch {
    return null;
  }
}

export async function setSessionCookie(sub: string): Promise<void> {
  const jar = await cookies();
  jar.set(COOKIE_NAME, sealSession(sub), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_S,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const jar = await cookies();
  jar.set(COOKIE_NAME, "", { httpOnly: true, path: "/", maxAge: 0 });
}

/** The signed-in user's profile, or null for guests / expired sessions. */
export async function getSessionUser(): Promise<UserProfile | null> {
  const jar = await cookies();
  const sub = openSession(jar.get(COOKIE_NAME)?.value);
  if (!sub) return null;
  return await getJSON<UserProfile>(`user:${sub}`);
}

// ------------------------------------------------------- Google verification

export interface GoogleIdentity {
  sub: string;
  email: string;
  name?: string;
  picture?: string;
}

/** Verify a Google ID token (from the GIS button) and extract the identity. */
export async function verifyGoogleCredential(credential: string): Promise<GoogleIdentity> {
  const res = await fetch(
    `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`,
  );
  if (!res.ok) throw new Error("Google could not verify the sign-in token");
  const data = (await res.json()) as Record<string, string>;
  if (data.aud !== googleClientId()) throw new Error("Sign-in token was issued for a different app");
  if (!data.sub || !data.email) throw new Error("Sign-in token is missing account details");
  return { sub: data.sub, email: data.email, name: data.name, picture: data.picture };
}
