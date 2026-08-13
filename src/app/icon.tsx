// Favicon, generated at the edge.

import { ImageResponse } from "next/og";

export const runtime = "edge";
export const size = { width: 64, height: 64 };
export const contentType = "image/png";

export default function Icon() {
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
          borderRadius: 14,
          fontSize: 36,
        }}
      >
        📞
      </div>
    ),
    size,
  );
}
