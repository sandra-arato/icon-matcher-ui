import { useEffect, useMemo, useState } from "react";
import "./App.css";
import { matchIconViaServer } from "./apiClient";
import type { MatchResult, Candidate } from "./matchIcon";
import { renderQualified } from "./providers";

const KEY_STORAGE = "icon-matcher:typesafe-api-key";
const EXAMPLES = ["channels", "brief", "audience", "szállítás", "settings"];

function IconPreview({ qualifiedName, size = 72 }: { qualifiedName: string; size?: number }) {
  try {
    return <span className="icon-preview">{renderQualified(qualifiedName, { size, color: "#1a1a1a" })}</span>;
  } catch {
    return <span className="icon-preview icon-preview--missing">?</span>;
  }
}

function AltRow({ candidate }: { candidate: Candidate }) {
  return (
    <li className="alt-row">
      <IconPreview qualifiedName={candidate.icon} size={28} />
      <span className="alt-name">{candidate.icon}</span>
      <span className="alt-desc">{candidate.description}</span>
      <span className="alt-confidence">{candidate.confidence.toFixed(2)}</span>
    </li>
  );
}

export default function App() {
  const [apiKey, setApiKey] = useState(() => sessionStorage.getItem(KEY_STORAGE) ?? "");
  const [title, setTitle] = useState("");
  const [result, setResult] = useState<MatchResult | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (apiKey) sessionStorage.setItem(KEY_STORAGE, apiKey);
    else sessionStorage.removeItem(KEY_STORAGE);
  }, [apiKey]);

  const candidateCount = useMemo(() => result?.candidateCount ?? null, [result]);

  async function runMatch(t: string) {
    if (!apiKey.trim()) {
      setError("Paste your TypeSafe API key first.");
      return;
    }
    if (!t.trim()) return;

    setStatus("loading");
    setError(null);
    setResult(null);
    setLog([]);

    try {
      const r = await matchIconViaServer(apiKey.trim(), t.trim());
      setResult(r);
      setLog(r.log);
      setStatus("idle");
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="page">
      <header>
        <h1>icon-matcher</h1>
        <p className="subtitle">
          Type a UI section title, get back the icon that best fits — matched by{" "}
          <a href="https://docs.typesafe.ai" target="_blank" rel="noreferrer">
            TypeSafe.ai
          </a>
          's <code>Choice</code> primitive across Hugeicons + Lucide, no keyword search.
        </p>
      </header>

      <section className="card">
        <label className="field">
          <span>TypeSafe API key</span>
          <input
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="ts_..."
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
        </label>
        <p className="hint">
          Stored only in this browser tab's session storage. TypeSafe's API doesn't accept
          direct browser calls (no CORS headers), so this sends the key to a tiny local proxy
          on your own machine (<code>server/index.ts</code> — ~50 lines, forwards the request
          and nothing else) which then calls <code>api.typesafe.ai</code>. Run it with{" "}
          <code>npm run server</code> alongside <code>npm run dev</code>. See{" "}
          <a href="https://github.com/sandra-arato/icon-matcher" target="_blank" rel="noreferrer">
            icon-matcher
          </a>{" "}
          for the matching architecture this reuses.
        </p>

        <label className="field">
          <span>UI section title</span>
          <input
            type="text"
            placeholder="e.g. channels"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && runMatch(title)}
          />
        </label>

        <div className="examples">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              className="chip"
              onClick={() => {
                setTitle(ex);
                runMatch(ex);
              }}
            >
              {ex}
            </button>
          ))}
        </div>

        <button type="button" className="submit" disabled={status === "loading"} onClick={() => runMatch(title)}>
          {status === "loading" ? "Matching…" : "Match icon"}
        </button>

        {error && <p className="error">{error}</p>}
      </section>

      {log.length > 0 && (
        <section className="card log-card">
          <h2>What's happening</h2>
          <ul className="log">
            {log.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        </section>
      )}

      {result && (
        <section className="card result-card">
          <div className="result-main">
            <IconPreview qualifiedName={result.icon} size={80} />
            <div>
              <div className="result-name">{result.icon}</div>
              <div className={`badge badge--${result.band}`}>
                confidence {result.confidence.toFixed(2)} · {result.band}
                {result.tieBroken ? " · tie-broken" : ""}
              </div>
            </div>
          </div>

          {result.alternatives.length > 1 && (
            <>
              <h3>Other candidates considered</h3>
              <ul className="alt-list">
                {result.alternatives.map((c) => (
                  <AltRow key={c.icon} candidate={c} />
                ))}
              </ul>
            </>
          )}

          {candidateCount && (
            <p className="hint">
              Every one of the {candidateCount.toLocaleString()} icons across both families got a
              real Choice judgment in one API call, split into {result.shardCount} parallel
              questions to stay under the 255-option cap — nothing was pre-filtered by keyword
              matching.
            </p>
          )}
        </section>
      )}
    </div>
  );
}
