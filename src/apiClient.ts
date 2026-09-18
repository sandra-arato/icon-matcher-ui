import type { MatchResult } from "./matchIcon";

const SERVER_URL = "http://localhost:8787/api/match";

export interface MatchResponse extends MatchResult {
  log: string[];
}

/**
 * Calls the local Node proxy (see server/index.ts) instead of api.typesafe.ai directly —
 * TypeSafe's API doesn't send CORS headers, so a direct browser call isn't possible. The
 * proxy runs on your own machine and does nothing but forward this request.
 */
export async function matchIconViaServer(apiKey: string, title: string): Promise<MatchResponse> {
  const res = await fetch(SERVER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apiKey, title }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Proxy request failed (${res.status}). Is \`npm run server\` running?`);
  }

  return res.json();
}
