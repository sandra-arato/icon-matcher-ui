import { useEffect, useRef, useState } from "react";
import "./App.css";
import { matchIconViaServer, type MatchResponse } from "./apiClient";
import type { Candidate } from "./matchIcon";
import { renderQualified, getCandidateCountsByProvider, type FamilyCount } from "./providers";

const EXAMPLES = ["channels", "brief", "audience", "settings"];
const FAMILIES = getCandidateCountsByProvider();
const TOTAL_ICONS = sumCounts(FAMILIES);
const REPO_URL = "https://github.com/sandra-arato/icon-matcher-ui";

interface HistoryEntry {
  id: number;
  label: string;
  /** The icon-set configuration captured when this request was sent — never updated afterwards. */
  families: FamilyCount[];
  durationMs: number;
  result: MatchResponse;
}

interface PendingRequest {
  label: string;
  families: FamilyCount[];
  startedAt: number;
}

function sumCounts(families: FamilyCount[]): number {
  return families.reduce((sum, f) => sum + f.count, 0);
}

function familyLabel(id: string): string {
  return FAMILIES.find((f) => f.id === id)?.label ?? id;
}

function configLabel(families: FamilyCount[]): string {
  return families.map((f) => f.label).join(" + ");
}

function splitQualified(qualifiedName: string): { family: string; name: string } {
  const i = qualifiedName.indexOf(":");
  return i === -1 ? { family: "?", name: qualifiedName } : { family: qualifiedName.slice(0, i), name: qualifiedName.slice(i + 1) };
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 10_000) return `${(ms / 1000).toFixed(2)} s`;
  return `${(ms / 1000).toFixed(1)} s`;
}

function friendlyError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (err instanceof TypeError) return "Couldn't reach the matching server. Check your connection and try again.";
  return message;
}

function IconPreview({ qualifiedName, size }: { qualifiedName: string; size: number }) {
  try {
    return <span className="icon-preview">{renderQualified(qualifiedName, { size, color: "currentColor" })}</span>;
  } catch {
    return <span className="icon-preview icon-preview--missing" style={{ width: size, height: size }}>?</span>;
  }
}

/** A proportional bar of the full icon space; enabled families are filled, disabled ones are hollow. */
function SetBar({ enabledIds, compact = false }: { enabledIds: string[]; compact?: boolean }) {
  return (
    <span className={`set-bar${compact ? " set-bar--compact" : ""}`} aria-hidden="true">
      {FAMILIES.map((f) => (
        <span
          key={f.id}
          className={`set-bar__seg${enabledIds.includes(f.id) ? " is-on" : ""}`}
          style={{ flexGrow: f.count }}
        />
      ))}
    </span>
  );
}

function Arrow() {
  return (
    <svg className="flow__arrow" width="32" height="12" viewBox="0 0 32 12" aria-hidden="true">
      <path d="M0 6h29M24 1l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.25" />
    </svg>
  );
}

function FlowDiagram({ latest, availableCount }: { latest: HistoryEntry | undefined; availableCount: number }) {
  return (
    <figure className="flow" aria-label="How it works">
      <div className="flow__node">
        <span className="kicker">Generated label</span>
        <span className="flow__label">“{latest?.label ?? "channels"}”</span>
        <span className="flow__caption">open-ended input</span>
      </div>
      <Arrow />
      <div className="flow__node flow__node--jav">
        <span className="kicker">Jav</span>
        <span className="flow__jav">
          chooses from <strong>{availableCount.toLocaleString()}</strong> available icons
        </span>
        <span className="flow__caption">picks, doesn't invent</span>
      </div>
      <Arrow />
      <div className="flow__node">
        <span className="kicker">Selected icon</span>
        <span className={`flow__slot${latest ? "" : " flow__slot--empty"}`}>
          {latest && <IconPreview qualifiedName={latest.result.icon} size={28} />}
        </span>
        <span className="flow__caption">constrained output</span>
      </div>
    </figure>
  );
}

function AltRow({ candidate }: { candidate: Candidate }) {
  const { family, name } = splitQualified(candidate.icon);
  return (
    <li className="alt-row">
      <IconPreview qualifiedName={candidate.icon} size={18} />
      <span className="mono">{name}</span>
      <span className="muted">{familyLabel(family)}</span>
      <span className="alt-row__confidence">{candidate.confidence.toFixed(2)}</span>
    </li>
  );
}

function HistoryRow({ entry }: { entry: HistoryEntry }) {
  const { result } = entry;
  const { family, name } = splitQualified(result.icon);
  const enabledIds = entry.families.map((f) => f.id);

  return (
    <li className="run">
      <div className="run__grid">
        <span className="run__label" title={entry.label}>{entry.label}</span>
        <span className="run__icon">
          <IconPreview qualifiedName={result.icon} size={24} />
        </span>
        <span className="run__pick">
          <span className="mono run__name" title={name}>{name}</span>
          <span className="muted">{familyLabel(family)}</span>
        </span>
        <span className="run__config" title={`${sumCounts(entry.families).toLocaleString()} icons available for this run`}>
          <SetBar enabledIds={enabledIds} compact />
          <span>{configLabel(entry.families)}</span>
          <span className="muted">{sumCounts(entry.families).toLocaleString()}</span>
        </span>
        <span className="run__time">
          {formatDuration(entry.durationMs)}
          {result.calibrated && (
            <span className="run__warmup" title="This request also ran a one-time size calibration, so it took longer than usual.">
              incl. warm-up
            </span>
          )}
        </span>
      </div>

      <details className="run__details">
        <summary>Details</summary>
        <div className="run__details-body">
          <p className="muted">
            Confidence {result.confidence.toFixed(2)}
            {result.tieBroken ? " · decided by a direct comparison of the top two" : ""}
          </p>
          {result.alternatives.length > 1 && (
            <>
              <span className="kicker">Top candidates</span>
              <ul className="alt-list">
                {result.alternatives.map((c) => (
                  <AltRow key={c.icon} candidate={c} />
                ))}
              </ul>
            </>
          )}
          {result.log.length > 0 && (
            <>
              <span className="kicker">Request log</span>
              <ol className="log">
                {result.log.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ol>
            </>
          )}
        </div>
      </details>
    </li>
  );
}

function PendingRow({ pending }: { pending: PendingRequest }) {
  const [now, setNow] = useState(() => performance.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(performance.now()), 100);
    return () => clearInterval(timer);
  }, []);

  return (
    <li className="run run--pending" role="status">
      <div className="run__grid">
        <span className="run__label">{pending.label}</span>
        <span className="run__icon run__icon--pending" aria-hidden="true" />
        <span className="run__pick muted">Choosing from {sumCounts(pending.families).toLocaleString()} icons…</span>
        <span className="run__config">
          <SetBar enabledIds={pending.families.map((f) => f.id)} compact />
          <span>{configLabel(pending.families)}</span>
          <span className="muted">{sumCounts(pending.families).toLocaleString()}</span>
        </span>
        <span className="run__time muted">{((now - pending.startedAt) / 1000).toFixed(1)} s</span>
      </div>
    </li>
  );
}

export default function App() {
  const [title, setTitle] = useState("");
  const [enabled, setEnabled] = useState<string[]>(() => FAMILIES.map((f) => f.id));
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [pending, setPending] = useState<PendingRequest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const nextId = useRef(1);

  const selectedFamilies = FAMILIES.filter((f) => enabled.includes(f.id));
  const availableCount = sumCounts(selectedFamilies);
  const noSetSelected = selectedFamilies.length === 0;
  const loading = pending !== null;

  function toggleFamily(id: string) {
    setEnabled((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function runMatch(raw: string) {
    const label = raw.trim();
    if (!label || noSetSelected || inFlight.current) return;

    inFlight.current = true;
    const families = selectedFamilies;
    const startedAt = performance.now();
    setError(null);
    setPending({ label, families, startedAt });

    try {
      const result = await matchIconViaServer(
        label,
        families.map((f) => f.id),
      );
      const durationMs = performance.now() - startedAt;
      setHistory((prev) => [{ id: nextId.current++, label, families, durationMs, result }, ...prev]);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      inFlight.current = false;
      setPending(null);
    }
  }

  return (
    <div className="page">
      <header className="hero">
        <p className="wordmark">icon-matcher</p>
        <h1>Choosing icons for UI that doesn't exist yet.</h1>
        <p className="lede">
          Generative interfaces can create labels at runtime, so you can't always maintain a hand-written icon
          mapping. This experiment uses Jav to pick a fitting icon from a real, constrained set of available
          icons — rather than inventing an icon name.
        </p>
        <p className="lede lede--secondary">
          Change the size of the icon set and see how the available choices affect response time.
        </p>
      </header>

      <FlowDiagram latest={history[0]} availableCount={availableCount} />

      <section className="card" aria-labelledby="try-heading">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            runMatch(title);
          }}
        >
          <h2 id="try-heading" className="kicker">Try a label</h2>
          <label htmlFor="label-input" className="helper">
            Imagine this label was generated at runtime.
          </label>
          <input
            id="label-input"
            className="label-input"
            type="text"
            placeholder="e.g. channels"
            autoComplete="off"
            spellCheck={false}
            maxLength={200}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />

          <div className="examples" aria-label="Example labels">
            {EXAMPLES.map((ex) => (
              <button
                key={ex}
                type="button"
                className={`chip${title.trim() === ex ? " is-active" : ""}`}
                disabled={loading || noSetSelected}
                onClick={() => {
                  setTitle(ex);
                  runMatch(ex);
                }}
              >
                {ex}
              </button>
            ))}
          </div>

          <div className="sets" role="group" aria-labelledby="sets-heading">
            <div className="sets__head">
              <span id="sets-heading" className="kicker">Icon set</span>
              <span className="sets__total" aria-live="polite">
                <strong>{availableCount.toLocaleString()}</strong> available icons
              </span>
            </div>

            <div className="sets__options">
              {FAMILIES.map((f) => {
                const on = enabled.includes(f.id);
                return (
                  <label key={f.id} className={`set-option${on ? " is-on" : ""}`}>
                    <input type="checkbox" checked={on} onChange={() => toggleFamily(f.id)} />
                    <span className="set-option__box" aria-hidden="true">
                      <svg width="10" height="8" viewBox="0 0 10 8">
                        <path d="M1 4l2.5 2.5L9 1" fill="none" stroke="currentColor" strokeWidth="1.6" />
                      </svg>
                    </span>
                    <span className="set-option__name">{f.label}</span>
                    <span className="set-option__count">{f.count.toLocaleString()}</span>
                  </label>
                );
              })}
            </div>

            <SetBar enabledIds={enabled} />

            {noSetSelected && (
              <p className="validation" role="alert">
                Select at least one icon set.
              </p>
            )}
          </div>

          <button type="submit" className="submit" disabled={loading || noSetSelected || !title.trim()}>
            {loading ? (
              <>
                <span className="spinner" aria-hidden="true" /> Matching…
              </>
            ) : (
              "Match icon"
            )}
          </button>

          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </form>
      </section>

      <section className="history" aria-labelledby="history-heading">
        <div className="history__head">
          <h2 id="history-heading" className="kicker">Match history</h2>
          {history.length > 0 && (
            <span className="muted">
              {history.length} {history.length === 1 ? "run" : "runs"}
            </span>
          )}
        </div>
        <p className="helper">Run the same label with different icon sets to compare results and response times.</p>

        {history.length === 0 && !pending ? (
          <div className="history__empty">
            <p>No matches yet.</p>
            <p className="muted">
              Try <span className="mono">channels</span> with both sets, then switch Lucide off and run it again.
            </p>
          </div>
        ) : (
          <ol className="runs">
            {pending && <PendingRow pending={pending} />}
            {history.map((entry) => (
              <HistoryRow key={entry.id} entry={entry} />
            ))}
          </ol>
        )}
      </section>

      <footer className="footer">
        <p>
          Icon selection by Jav · {TOTAL_ICONS.toLocaleString()} icons across {configLabel(FAMILIES)}
        </p>
        <p className="footer__links">
          <a href={REPO_URL} target="_blank" rel="noreferrer">
            View source →
          </a>
          <a href={`${REPO_URL}#setup-local-dev`} target="_blank" rel="noreferrer">
            Run your own copy →
          </a>
        </p>
        <p className="footer__fine">
          Each request splits the enabled icons into batches that fit a single Jav request and runs them in
          parallel; if the two best candidates are close, they're compared directly. Open a result's details for
          its request log. This is a shared public demo, rate-limited per visitor.
        </p>
      </footer>
    </div>
  );
}
