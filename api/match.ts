import type { VercelRequest, VercelResponse } from "@vercel/node";
import { matchIcon } from "../src/matchIcon";

/**
 * Vercel's Node.js runtime, deployed alongside the static frontend on the same domain — so
 * the browser's call to /api/match is same-origin, no CORS headers needed at all.
 *
 * The TypeSafe API key lives only in this function's environment (TYPESAFE_API_KEY, set in
 * the Vercel project's env vars) — it's never sent to or accepted from the client, so
 * visitors don't need a key of their own.
 */

const WINDOW_MS = 60 * 60 * 1000; // 1 hour
const MAX_REQUESTS_PER_WINDOW = 100;
const MAX_TITLE_LENGTH = 200;

// Best-effort only: this Map lives in one function instance's memory, so a cold start or a
// second concurrent instance resets/splits it. Good enough to blunt casual abuse on a small
// hobby demo; not a substitute for a real distributed limiter under real load.
const hits = new Map<string, number[]>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  if (recent.length > 0) hits.set(ip, recent);
  return recent.length > MAX_REQUESTS_PER_WINDOW;
}

function clientIp(req: VercelRequest): string {
  const forwarded = req.headers["x-forwarded-for"];
  const first = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(",")[0];
  return first?.trim() || req.socket.remoteAddress || "unknown";
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const ip = clientIp(req);
  if (isRateLimited(ip)) {
    res.status(429).json({ error: "Rate limit exceeded — try again later." });
    return;
  }

  const { title } = (req.body ?? {}) as { title?: string };
  if (!title || typeof title !== "string" || title.length > MAX_TITLE_LENGTH) {
    res.status(400).json({ error: `title is required (max ${MAX_TITLE_LENGTH} characters)` });
    return;
  }

  const apiKey = process.env.TYPESAFE_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "Server is missing TYPESAFE_API_KEY" });
    return;
  }

  try {
    const log: string[] = [];
    const result = await matchIcon(apiKey, title, (msg) => log.push(msg));
    res.status(200).json({ ...result, log });
  } catch (err) {
    console.error("Match request failed:", err instanceof Error ? err.message : err);
    res.status(502).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
}
