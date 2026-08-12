// Key-value persistence with two backends:
//  - Upstash Redis / Vercel KV (REST) in production
//  - local JSON file under .data/ for development (survives dev-server reloads)
//
// Values are JSON documents. Keys are namespaced: res:{id}, call:{id}, lib:{hash}

import { promises as fs } from "fs";
import path from "path";
import { config } from "./config";

const DATA_DIR = path.join(process.cwd(), ".data");
const DATA_FILE = path.join(DATA_DIR, "store.json");

type Json = unknown;

interface Backend {
  get(key: string): Promise<Json | null>;
  set(key: string, value: Json): Promise<void>;
  del(key: string): Promise<void>;
  /** List all keys with the given prefix */
  keys(prefix: string): Promise<string[]>;
}

// ---------------------------------------------------------------- Redis REST

class RedisBackend implements Backend {
  constructor(private url: string, private token: string) {}

  private async cmd(command: (string | number)[]): Promise<unknown> {
    const res = await fetch(this.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(command),
    });
    if (!res.ok) throw new Error(`KV error ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as { result: unknown };
    return data.result;
  }

  async get(key: string) {
    const raw = (await this.cmd(["GET", key])) as string | null;
    return raw == null ? null : JSON.parse(raw);
  }
  async set(key: string, value: Json) {
    await this.cmd(["SET", key, JSON.stringify(value)]);
  }
  async del(key: string) {
    await this.cmd(["DEL", key]);
  }
  async keys(prefix: string) {
    // SCAN cursor loop; fine at this scale (hundreds of keys).
    let cursor = "0";
    const out: string[] = [];
    do {
      const res = (await this.cmd(["SCAN", cursor, "MATCH", `${prefix}*`, "COUNT", 200])) as [
        string,
        string[],
      ];
      cursor = res[0];
      out.push(...res[1]);
    } while (cursor !== "0");
    return out;
  }
}

// ------------------------------------------------------------ Local file dev

class FileBackend implements Backend {
  private cache: Record<string, Json> | null = null;
  private writeQueue: Promise<void> = Promise.resolve();

  private async load(): Promise<Record<string, Json>> {
    if (this.cache) return this.cache;
    try {
      const raw = await fs.readFile(DATA_FILE, "utf8");
      this.cache = JSON.parse(raw);
    } catch {
      this.cache = {};
    }
    return this.cache!;
  }

  private persist() {
    // Serialize writes to avoid interleaved file writes.
    this.writeQueue = this.writeQueue.then(async () => {
      await fs.mkdir(DATA_DIR, { recursive: true });
      await fs.writeFile(DATA_FILE, JSON.stringify(this.cache ?? {}, null, 2));
    });
    return this.writeQueue;
  }

  async get(key: string) {
    const db = await this.load();
    return key in db ? db[key] : null;
  }
  async set(key: string, value: Json) {
    const db = await this.load();
    db[key] = value;
    await this.persist();
  }
  async del(key: string) {
    const db = await this.load();
    delete db[key];
    await this.persist();
  }
  async keys(prefix: string) {
    const db = await this.load();
    return Object.keys(db).filter((k) => k.startsWith(prefix));
  }
}

// ----------------------------------------------------------------- Singleton

let backend: Backend | null = null;

export function store(): Backend {
  if (!backend) {
    backend =
      config.kv.url && config.kv.token
        ? new RedisBackend(config.kv.url, config.kv.token)
        : new FileBackend();
  }
  return backend;
}

export async function getJSON<T>(key: string): Promise<T | null> {
  return (await store().get(key)) as T | null;
}

export async function setJSON<T>(key: string, value: T): Promise<void> {
  await store().set(key, value);
}

export async function listJSON<T>(prefix: string): Promise<T[]> {
  const s = store();
  const keys = await s.keys(prefix);
  const values = await Promise.all(keys.map((k) => s.get(k)));
  return values.filter((v): v is T => v != null) as T[];
}
