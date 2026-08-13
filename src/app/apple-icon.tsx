// Home-screen icon for iOS "Add to Home Screen", generated at the edge.

import { ImageResponse } from "next/og";

export const runtime = "edge";
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(180deg, #bb3b22 0%, #8f2c18 100%)",
          fontSize: 100,
        }}
      >
        📞
      </div>
    ),
    size,
  );
}
