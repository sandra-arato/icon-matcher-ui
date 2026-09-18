import type { MatchResult } from "./matchIcon";

// In dev this calls the separate local proxy (npm run server, on :8787 — a different origin
// than the Vite dev server, hence server/index.ts still sets its own CORS headers). In
// production this is same-origin: the Vercel serverless function at api/match.ts, deployed
// on the same domain as the page, so no CORS headers are needed there at all.
const SERVER_URL = import.meta.env.DEV ? "http://localhost:8787/api/match" : "/api/match";

export interface MatchResponse extends MatchResult {
  log: string[];
}

/**
 * No API key here — it lives only in the server's environment (TYPESAFE_API_KEY), never in
 * the browser. This just asks the server to run a match for a title.
 */
export async function matchIconViaServer(title: string): Promise<MatchResponse> {
  const res = await fetch(SERVER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed (${res.status})`);
  }

  return res.json();
}
