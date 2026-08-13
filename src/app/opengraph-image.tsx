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
          background: "linear-gradient(160deg, #f5f5f7 0%, #eaf3ff 60%, #dcebff 100%)",
          fontFamily: "sans-serif",
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
            background: "linear-gradient(180deg, #2997ff 0%, #0071e3 100%)",
            boxShadow: "0 20px 50px rgba(0, 113, 227, 0.35)",
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
            color: "#1d1d1f",
            letterSpacing: "-2px",
            display: "flex",
          }}
        >
          Agentic Reservations
        </div>
        <div
          style={{
            fontSize: 32,
            color: "#6e6e73",
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
              background: "#ffffff",
              borderRadius: 999,
              padding: "10px 28px",
              color: "#1d1d1f",
              boxShadow: "0 4px 14px rgba(0,0,0,0.08)",
            }}
          >
            🇯🇵 日本語
          </div>
          <div
            style={{
              display: "flex",
              background: "#ffffff",
              borderRadius: 999,
              padding: "10px 28px",
              color: "#1d1d1f",
              boxShadow: "0 4px 14px rgba(0,0,0,0.08)",
            }}
          >
            🇸🇬 English
          </div>
          <div
            style={{
              display: "flex",
              background: "#ffffff",
              borderRadius: 999,
              padding: "10px 28px",
              color: "#1d1d1f",
              boxShadow: "0 4px 14px rgba(0,0,0,0.08)",
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
