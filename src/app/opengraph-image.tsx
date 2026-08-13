// Link-preview graphic (Open Graph / Twitter card), generated at the edge.
// Shown when the app's URL is shared in iMessage, WhatsApp, Slack, etc.

import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "Agentic Reservations — AI reservation agent for restaurants in Japan and Singapore";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(160deg, #f5efe2 0%, #efe6d5 60%, #e9dec9 100%)",
          fontFamily: "Georgia, serif",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 160,
            height: 160,
            borderRadius: 40,
            background: "linear-gradient(180deg, #bb3b22 0%, #8f2c18 100%)",
            boxShadow: "0 20px 50px rgba(143, 44, 24, 0.35)",
            fontSize: 84,
            marginBottom: 48,
          }}
        >
          📞
        </div>
        <div
          style={{
            fontSize: 76,
            fontWeight: 700,
            color: "#211c15",
            letterSpacing: "-2px",
            display: "flex",
          }}
        >
          Agentic Reservations
        </div>
        <div
          style={{
            fontSize: 32,
            color: "#5a5142",
            marginTop: 18,
            display: "flex",
          }}
        >
          AI reservation agent for restaurants in Japan &amp; Singapore
        </div>
        <div
          style={{
            display: "flex",
            gap: 16,
            marginTop: 44,
            fontSize: 28,
          }}
        >
          <div
            style={{
              display: "flex",
              background: "#fffdf7",
              borderRadius: 999,
              padding: "10px 28px",
              color: "#211c15",
              boxShadow: "0 4px 14px rgba(40,30,15,0.12)",
            }}
          >
            🇯🇵 日本語
          </div>
          <div
            style={{
              display: "flex",
              background: "#fffdf7",
              borderRadius: 999,
              padding: "10px 28px",
              color: "#211c15",
              boxShadow: "0 4px 14px rgba(40,30,15,0.12)",
            }}
          >
            🇸🇬 English
          </div>
          <div
            style={{
              display: "flex",
              background: "#fffdf7",
              borderRadius: 999,
              padding: "10px 28px",
              color: "#211c15",
              boxShadow: "0 4px 14px rgba(40,30,15,0.12)",
            }}
          >
            中文
          </div>
        </div>
      </div>
    ),
    size,
  );
}
