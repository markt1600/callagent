"use client";

// Renders Google's "Sign in with Google" button (Google Identity Services)
// and exchanges the returned ID token for our session cookie.

import { useEffect, useRef } from "react";
import type { UserProfile } from "@/lib/types";

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (opts: {
            client_id: string;
            callback: (response: { credential: string }) => void;
          }) => void;
          renderButton: (parent: HTMLElement, options: Record<string, unknown>) => void;
        };
      };
    };
  }
}

const GSI_SRC = "https://accounts.google.com/gsi/client";

export default function GoogleSignIn({
  clientId,
  onSignedIn,
  onError,
}: {
  clientId: string;
  onSignedIn: (user: UserProfile, firstLogin: boolean) => void;
  onError?: (message: string) => void;
}) {
  const slot = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;

    function render() {
      if (cancelled || !slot.current || !window.google) return;
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: async (response) => {
          try {
            const res = await fetch("/api/auth/google", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ credential: response.credential }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || `Sign-in failed (${res.status})`);
            onSignedIn(data.user as UserProfile, Boolean(data.firstLogin));
          } catch (e) {
            onError?.(e instanceof Error ? e.message : String(e));
          }
        },
      });
      slot.current.innerHTML = "";
      window.google.accounts.id.renderButton(slot.current, {
        theme: "outline",
        size: "large",
        shape: "pill",
        text: "signin_with",
      });
    }

    if (window.google) {
      render();
    } else {
      let script = document.querySelector<HTMLScriptElement>(`script[src="${GSI_SRC}"]`);
      if (!script) {
        script = document.createElement("script");
        script.src = GSI_SRC;
        script.async = true;
        document.head.appendChild(script);
      }
      script.addEventListener("load", render);
    }
    return () => {
      cancelled = true;
    };
  }, [clientId, onSignedIn, onError]);

  return <div ref={slot} style={{ minHeight: 44 }} />;
}
