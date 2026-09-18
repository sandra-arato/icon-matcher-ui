# icon-matcher-ui

A browser-only UI for [icon-matcher](https://github.com/sandra-arato/icon-matcher): paste
your [TypeSafe.ai](https://typesafe.ai) API key, type a UI section title, and see which
icon (across Hugeicons + Lucide) the `Choice` primitive picks — live, with no backend at
all. The whole point is transparency: you can see the request go out, the shard count, the
confidence score, and the runner-up candidates, not just a final answer.

See the [icon-matcher README](https://github.com/sandra-arato/icon-matcher) for why this
uses TypeSafe's `Choice` primitive instead of keyword/lexical search, and how the sharded
fan-out across ~8,800 icons works. This repo just puts a UI on top of the same logic
(`src/matchIcon.ts`, `src/providers/`), adapted to run entirely client-side.

## ⚠️ Known open issue: CORS

TypeSafe's SDK has a `dangerouslyAllowBrowser: true` flag specifically for calling their
API straight from a browser — but in testing (with a placeholder key, from `localhost`),
the preflight `OPTIONS https://api.typesafe.ai/v1/systemone` request came back `400`
instead of the `200`/`204` a working CORS preflight needs. That happens before your API key
is even checked, so a fake key isn't the cause.

**This needs verifying with a real key before relying on it.** If your account/project
needs its allowed origins configured somewhere in TypeSafe's dashboard (common for APIs
that support browser calls), do that first. If the same `400` happens with a real key, this
UI's "call the API directly from the browser" approach won't work as-is, and the calls
would need to go through a minimal same-origin proxy instead (the key still wouldn't touch
any database — it'd just relay through a server you control instead of going straight from
the page). That fallback isn't built yet, pending this being confirmed one way or the other.

## Setup

```bash
npm install
npm run dev
```

Open the printed local URL, paste your TypeSafe API key, type a title (or click one of the
example chips), and hit "Match icon".

## Security model

- Your API key is kept only in this browser tab's `sessionStorage` — it's never sent
  anywhere except directly to `api.typesafe.ai`.
- There is no backend, no logging, no analytics. Closing the tab clears the key.
- Because the key lives in browser memory, anyone with access to that browser tab (devtools,
  a malicious extension, etc.) could read it — that's the tradeoff `dangerouslyAllowBrowser`
  is warning about. Use a key you're comfortable having live in a browser session, not a
  production secret.

## What it shows

- The full request: every one of the ~8,800 icons across both families gets a real `Choice`
  judgment in one API call, split into ~37 parallel shard questions to stay under the
  255-option cap — the "What's happening" panel shows this as it runs.
- The winning icon, rendered live, with its confidence score and band (high/medium/none).
- The runner-up candidates when confidence is only medium, so you can see what the model
  was weighing.

## License

[MIT](LICENSE) — icons remain under each family's own license
([Hugeicons](https://hugeicons.com/license), [Lucide](https://lucide.dev/license) — ISC).
