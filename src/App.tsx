import { useMemo, useState } from "react";
import "./App.css";
import { matchIconViaServer } from "./apiClient";
import type { MatchResult, Candidate } from "./matchIcon";
import { renderQualified, getCandidateCountsByProvider } from "./providers";

const EXAMPLES = ["channels", "brief", "audience", "szállítás", "settings"];
const FAMILIES = getCandidateCountsByProvider();
const TOTAL_ICONS = FAMILIES.reduce((sum, f) => sum + f.count, 0);

function splitQualified(qualifiedName: string): { family: string; name: string } {
  const i = qualifiedName.indexOf(":");
  return i === -1 ? { family: "?", name: qualifiedName } : { family: qualifiedName.slice(0, i), name: qualifiedName.slice(i + 1) };
}

function IconPreview({ qualifiedName, size = 72 }: { qualifiedName: string; size?: number }) {
  try {
    return <span className="icon-preview">{renderQualified(qualifiedName, { size, color: "#1a1a1a" })}</span>;
  } catch {
    return <span className="icon-preview icon-preview--missing">?</span>;
  }
}

function FamilyTag({ family }: { family: string }) {
  return <span className={`family-tag family-tag--${family}`}>{family}</span>;
}

function AltRow({ candidate }: { candidate: Candidate }) {
  const { family, name } = splitQualified(candidate.icon);
  return (
    <li className="alt-row">
      <IconPreview qualifiedName={candidate.icon} size={28} />
      <FamilyTag family={family} />
      <span className="alt-name">{name}</span>
      <span className="alt-desc">{candidate.description}</span>
      <span className="alt-confidence">{candidate.confidence.toFixed(2)}</span>
    </li>
  );
}

export default function App() {
  const [title, setTitle] = useState("");
  const [result, setResult] = useState<MatchResult | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  const candidateCount = useMemo(() => result?.candidateCount ?? null, [result]);

  async function runMatch(t: string) {
    if (!t.trim()) return;

    setStatus("loading");
    setError(null);
    setResult(null);
    setLog([]);

    try {
      const r = await matchIconViaServer(t.trim());
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
          's <code>Choice</code> primitive, no keyword search.
        </p>
        <p className="families-line">
          Searching {TOTAL_ICONS.toLocaleString()} icons across{" "}
          {FAMILIES.map((f, i) => (
            <span key={f.id}>
              {i > 0 && " + "}
              <strong>{f.count.toLocaleString()} {f.id}</strong>
            </span>
          ))}
          {" "}— every match considers all of them together, in the same request. This is a
          shared public demo (rate-limited per visitor) — see{" "}
          <a href="https://github.com/sandra-arato/icon-matcher-ui" target="_blank" rel="noreferrer">
            the source
          </a>{" "}
          to run your own copy with your own key.
        </p>
      </header>

      <section className="card">
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
              <div className="result-name">
                <FamilyTag family={splitQualified(result.icon).family} /> {splitQualified(result.icon).name}
              </div>
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
              Every one of the {candidateCount.toLocaleString()} icons across{" "}
              {result.families.map((f, i) => (
                <span key={f.id}>
                  {i > 0 && " + "}
                  {f.count.toLocaleString()} {f.id}
                </span>
              ))}{" "}
              got a real Choice judgment, split into {result.shardCount} shard questions grouped
              across as few API calls as fit TypeSafe's per-request size limit — nothing was
              pre-filtered by keyword matching. See the log above for exactly how many calls this
              particular match took.
            </p>
          )}
        </section>
      )}
    </div>
  );
}
