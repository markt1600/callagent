import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CallAgent — AI Phone Reservations",
  description: "AI agent that places live phone calls in Japan to make reservations",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
