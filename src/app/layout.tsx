import type { Metadata, Viewport } from "next";
import { Fraunces, Newsreader, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const fraunces = Fraunces({
  subsets: ["latin"],
  weight: ["400", "500", "600", "800"],
  style: ["normal", "italic"],
  variable: "--font-display",
});
const newsreader = Newsreader({
  subsets: ["latin"],
  style: ["normal", "italic"],
  variable: "--font-body",
});
const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
});

const APP_NAME = "Agentic Concierge";
const DESCRIPTION =
  "The AI concierge agent that crosses the line from virtual to reality — real phone calls, placed for you.";

const baseUrl =
  process.env.PUBLIC_BASE_URL ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

export const metadata: Metadata = {
  metadataBase: new URL(baseUrl),
  title: APP_NAME,
  description: DESCRIPTION,
  applicationName: APP_NAME,
  appleWebApp: {
    capable: true,
    title: APP_NAME,
    statusBarStyle: "default",
  },
  openGraph: {
    title: APP_NAME,
    description: DESCRIPTION,
    siteName: APP_NAME,
    type: "website",
    url: "/",
  },
  twitter: {
    card: "summary_large_image",
    title: APP_NAME,
    description: DESCRIPTION,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f5efe2",
  // Required for env(safe-area-inset-bottom) to be non-zero on iOS — without
  // it the fixed bottom nav floats over the home-indicator area in Safari.
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${fraunces.variable} ${newsreader.variable} ${jetbrainsMono.variable}`}>
        <div className="accent-bar" />
        {children}
      </body>
    </html>
  );
}
