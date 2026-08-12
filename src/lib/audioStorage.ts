// Durable audio file storage.
//  - Production: Vercel Blob (public URLs, playable directly by Twilio <Play>)
//  - Development: files under .data/audio served by /api/audio/[...key]

import { promises as fs } from "fs";
import path from "path";
import { put } from "@vercel/blob";
import { config } from "./config";

const LOCAL_AUDIO_DIR = path.join(process.cwd(), ".data", "audio");

/** Store MP3 bytes under `key` (e.g. "library/ab12cd.mp3"); returns a public URL. */
export async function storeAudio(key: string, bytes: Buffer): Promise<string> {
  if (config.blob.token) {
    const blob = await put(`audio/${key}`, bytes, {
      access: "public",
      contentType: "audio/mpeg",
      token: config.blob.token,
      addRandomSuffix: false,
    });
    return blob.url;
  }
  // Dev fallback: local filesystem, served via API route.
  const filePath = path.join(LOCAL_AUDIO_DIR, key);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, bytes);
  return `${config.baseUrl}/api/audio/${key}`;
}

/** Read locally stored audio (dev mode only). */
export async function readLocalAudio(key: string): Promise<Buffer | null> {
  try {
    const filePath = path.join(LOCAL_AUDIO_DIR, key);
    // Prevent path traversal out of the audio dir.
    if (!path.resolve(filePath).startsWith(path.resolve(LOCAL_AUDIO_DIR))) return null;
    return await fs.readFile(filePath);
  } catch {
    return null;
  }
}
