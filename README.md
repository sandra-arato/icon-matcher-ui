# icon-matcher-ui

Type a UI section title, see which icon (across Hugeicons + Lucide) TypeSafe.ai's `Choice`
primitive picks — live, as a public demo, no API key needed from visitors. The whole point
is transparency: you can see the request go out, the shard count, the confidence score, and
the runner-up candidates, not just a final answer.

See the [icon-matcher README](https://github.com/sandra-arato/icon-matcher) for why this
uses TypeSafe's `Choice` primitive instead of keyword/lexical search, and how the sharded
fan-out across ~8,800 icons works. This repo puts a UI on top of the same matching logic
(`src/matchIcon.ts`, `src/providers/`).

## Architecture

One key, held server-side only, shared across every visitor:

- **Production** (Vercel): `api/match.ts` is a Node.js serverless function, deployed on the
  same domain as the static frontend — so the browser's call to `/api/match` is same-origin,
  no CORS involved at all. The key comes from the `TYPESAFE_API_KEY` environment variable set
  in the Vercel project, never from the client.
- **Local dev**: `server/index.ts` is the same idea as a plain Node server (no framework),
  since the Vite dev server and this server are different ports/origins locally, so it needs
  its own CORS headers. Reads `TYPESAFE_API_KEY` from a local `.env`.

Both are thin adapters around the same `matchIcon.ts` — the actual matching logic doesn't
know or care which one called it.

## Abuse protection

Since this runs on a shared key with no visitor auth, `api/match.ts` rate-limits by IP: 100
requests/hour, plus a length cap on the title. The limiter is an in-memory counter — good
enough to blunt casual abuse on a low-traffic hobby demo, but it's per function instance, not
a real distributed store, so it's a soft limit under real load, not a hard guarantee. Vercel's
own edge network provides baseline DDoS protection independent of this; the in-app limiter is
specifically about not letting one visitor burn through the whole TypeSafe budget.

## Setup (local dev)

Two processes, both local:

```bash
npm install
cp .env.example .env   # fill in TYPESAFE_API_KEY
npm run server          # terminal 1 — the proxy, on :8787
npm run dev              # terminal 2 — the UI, on :5173
```

Open the printed UI URL, type a title (or click one of the example chips), and hit "Match
icon".

## Deploying your own copy

1. Push this repo to your own GitHub.
2. Import it into Vercel (auto-detects the Vite frontend + `api/` function, zero config).
3. In the Vercel project's Environment Variables, add `TYPESAFE_API_KEY` with your own key —
   set it in the dashboard, not in code or a committed file.

## What it shows

- The full request: every one of the ~8,800 icons across both families gets a real `Choice`
  judgment. TypeSafe rejects a request as too large well before its documented input-token
  budget is reached — the actual ceiling isn't published, so the first match after a cold
  start runs a quick calibration probe (a few sequential calls, halving the size on each
  rejection) to discover a safe request size, then reuses it for every match after that. If
  the real ceiling turns out to be small, that means *many* small parallel calls per match —
  the "What's happening" panel shows exactly how many, and why.
- The winning icon, rendered live, with its confidence score and band (high/medium/none).
- The runner-up candidates when confidence is only medium, so you can see what the model
  was weighing.

## License

[MIT](LICENSE) — icons remain under each family's own license
([Hugeicons](https://hugeicons.com/license), [Lucide](https://lucide.dev/license) — ISC).
