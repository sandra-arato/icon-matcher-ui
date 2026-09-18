# icon-matcher-ui

A UI for [icon-matcher](https://github.com/sandra-arato/icon-matcher): paste your
[TypeSafe.ai](https://typesafe.ai) API key, type a UI section title, and see which icon
(across Hugeicons + Lucide) the `Choice` primitive picks — live. The whole point is
transparency: you can see the request go out, the shard count, the confidence score, and
the runner-up candidates, not just a final answer.

See the [icon-matcher README](https://github.com/sandra-arato/icon-matcher) for why this
uses TypeSafe's `Choice` primitive instead of keyword/lexical search, and how the sharded
fan-out across ~8,800 icons works. This repo puts a UI on top of the same matching logic
(`src/matchIcon.ts`, `src/providers/`).

## Why there's a local server here

The original goal was a pure browser app — no backend at all, key never leaves the tab
except straight to `api.typesafe.ai`. That doesn't work: TypeSafe's API doesn't send CORS
headers, so the browser's preflight `OPTIONS` request gets rejected before your key is even
checked (confirmed with both a placeholder key and a real one).

So `server/index.ts` exists purely to route around that: a ~50-line Node server, no
framework, that does nothing but forward `POST /api/match` to `api.typesafe.ai` and relay
the response back. It never logs, stores, or forwards the key anywhere else — read the file,
that's the entire request path. It's still your machine, your key, your process; the
browser just can't reach TypeSafe's API directly, so this makes one hop through something
you control instead of something you don't.

## Setup

Two processes, both local:

```bash
npm install
npm run server   # terminal 1 — the proxy, on :8787
npm run dev      # terminal 2 — the UI, on :5173
```

Open the printed UI URL, paste your TypeSafe API key, type a title (or click one of the
example chips), and hit "Match icon".

## Security model

- Your API key is kept only in this browser tab's `sessionStorage`, and is only ever sent to
  `localhost:8787` (the proxy above) and from there straight to `api.typesafe.ai`.
- The proxy does no logging, no storage, no analytics — it's a pass-through.
- Because the key lives in browser memory and gets sent to a local process, this is fine for
  a key you're comfortable having live in a dev session, not a production secret. Don't
  deploy `server/index.ts` as-is to a public server — its CORS is wide open, which is only
  safe because it currently only ever listens on your own machine.

## What it shows

- The full request: every one of the ~8,800 icons across both families gets a real `Choice`
  judgment in one API call, split into ~37 parallel shard questions to stay under the
  255-option cap — the "What's happening" panel shows this once a match completes.
- The winning icon, rendered live, with its confidence score and band (high/medium/none).
- The runner-up candidates when confidence is only medium, so you can see what the model
  was weighing.

## License

[MIT](LICENSE) — icons remain under each family's own license
([Hugeicons](https://hugeicons.com/license), [Lucide](https://lucide.dev/license) — ISC).
