import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CallAgent — AI Restaurant Reservations",
  description: "AI reservation agent for restaurants in Japan and Singapore",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
