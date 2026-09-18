import { createServer } from "node:http";
import { matchIcon } from "../src/matchIcon";

const PORT = Number(process.env.PORT) || 8787;

/**
 * The whole reason this exists: api.typesafe.ai doesn't send CORS headers, so a browser
 * can't call it directly (confirmed — the preflight OPTIONS request gets no
 * Access-Control-Allow-Origin header at all). This server does nothing except forward the
 * request server-side, where CORS doesn't apply, and relay the result back. It never logs,
 * stores, or forwards the API key anywhere except straight to api.typesafe.ai — read the
 * handler below, that's the entire request path.
 *
 * Local-dev only: CORS here is wide open (reflects any origin) since this only ever runs on
 * your own machine for your own browser tab. Don't deploy this as-is to a public server.
 */
const server = createServer(async (req, res) => {
  const origin = req.headers.origin ?? "*";
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204).end();
    return;
  }

  if (req.method !== "POST" || req.url !== "/api/match") {
    res.writeHead(404, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "Not found" }));
    return;
  }

  try {
    const body = await readJsonBody(req);
    const { apiKey, title } = body as { apiKey?: string; title?: string };
    if (!apiKey || !title) {
      res.writeHead(400, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "apiKey and title are required" }));
      return;
    }

    const log: string[] = [];
    const result = await matchIcon(apiKey, title, (msg) => log.push(msg));

    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ ...result, log }));
  } catch (err) {
    console.error("Match request failed:", err instanceof Error ? err.message : err);
    res.writeHead(502, { "Content-Type": "application/json" }).end(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
    );
  }
});

function readJsonBody(req: import("node:http").IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

server.listen(PORT, () => {
  console.log(`icon-matcher proxy listening on http://localhost:${PORT}`);
  console.log("Forwards POST /api/match { apiKey, title } to api.typesafe.ai and nowhere else.");
});
