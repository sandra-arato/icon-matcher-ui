import { TypeSafeClient, choice } from "@typesafe-ai/sdk";
import { getAllCandidates, getCandidateCountsByProvider, type QualifiedIcon, type FamilyCount } from "./providers";

const CHUNK_SIZE = 240; // + 1 "none_of_these" option per chunk, stays under the 255-option Choice cap
const NONE_LABEL = "none_of_these";
const TIE_BREAK_MARGIN = 0.15; // if the top two shard confidences are this close, run a direct tie-break
const HIGH_CONFIDENCE = 0.5;
const DEFAULT_FALLBACK_ICON = "hugeicons:HelpCircleIcon";

export interface Candidate {
  icon: string; // qualified name, e.g. "lucide:House"
  description: string;
  confidence: number;
}

export interface MatchResult {
  icon: string;
  confidence: number;
  band: "high" | "medium" | "none";
  alternatives: Candidate[];
  shardCount: number;
  candidateCount: number;
  families: FamilyCount[];
  tieBroken: boolean;
}

export type Logger = (message: string) => void;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * This module runs server-side now (imported by server/index.ts) — the browser calls the
 * local proxy instead of this code directly, because api.typesafe.ai sends no CORS headers.
 * apiKey still comes in per-request rather than from an env var, since it's supplied by
 * whoever is using the page, not fixed for the whole server process.
 */
function makeClient(apiKey: string) {
  return new TypeSafeClient({ apiKey });
}

/**
 * TypeSafe rejects a request as too large well before the documented ~32k input-token
 * budget is reached (observed failure: only 718 input tokens). The actual constraint seems
 * to be the OUTPUT side — a probability per option, across every option in the request — so
 * it scales with total option *count*, not description length. There's no documented
 * threshold for this, so rather than guess a number, this detects the rejection and halves
 * the batch until it fits.
 */
function isTooManyOptionsError(err: unknown): boolean {
  const message = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return message.includes("token") || message.includes("too many") || message.includes("too large");
}

/** Largest number of shards known to fit in one call — discovered once, reused after that. */
let maxShardsPerCall: number | null = null;

async function runWave(client: TypeSafeClient, shards: QualifiedIcon[][], title: string, log: Logger): Promise<Candidate[]> {
  const byName = new Map(shards.flat().map((i) => [i.qualifiedName, i.description]));
  const questions = Object.fromEntries(
    shards.map((shard, i) => [
      `shard_${i}`,
      choice(`Which icon best represents a UI section titled '${title}'?`, {
        ...Object.fromEntries(shard.map((icon) => [icon.qualifiedName, icon.description])),
        [NONE_LABEL]: "No icon in this list fits well",
      }),
    ]),
  );

  try {
    const response = await client.systemOne({ state: { title }, questions });
    maxShardsPerCall = Math.max(maxShardsPerCall ?? 0, shards.length);

    const candidates: Candidate[] = [];
    for (const answer of Object.values(response.answers)) {
      if (answer.choice === NONE_LABEL) continue;
      candidates.push({ icon: answer.choice, description: byName.get(answer.choice) ?? answer.choice, confidence: answer.confidence });
    }
    return candidates;
  } catch (err) {
    if (shards.length > 1 && isTooManyOptionsError(err)) {
      const mid = Math.ceil(shards.length / 2);
      log(`${shards.length} shards (${shards.flat().length} options) in one call hit TypeSafe's size limit — splitting into ${mid} + ${shards.length - mid} and retrying...`);
      maxShardsPerCall = maxShardsPerCall ? Math.min(maxShardsPerCall, mid) : mid;
      const [a, b] = await Promise.all([
        runWave(client, shards.slice(0, mid), title, log),
        runWave(client, shards.slice(mid), title, log),
      ]);
      return [...a, ...b];
    }
    throw err;
  }
}

async function shardedFanOut(apiKey: string, title: string, log: Logger): Promise<Candidate[]> {
  const client = makeClient(apiKey);
  const icons = getAllCandidates();
  const shards = chunk(icons, CHUNK_SIZE);
  const waveSize = maxShardsPerCall ?? shards.length;
  const waves = chunk(shards, waveSize);

  log(`Sharding ${icons.length} icons (Hugeicons + Lucide) into ${shards.length} Choice questions across ${waves.length} call(s)...`);

  const results = await Promise.all(waves.map((wave) => runWave(client, wave, title, log)));
  const candidates = results.flat();
  candidates.sort((a, b) => b.confidence - a.confidence);
  return candidates;
}

async function tieBreak(apiKey: string, title: string, a: Candidate, b: Candidate, log: Logger): Promise<Candidate> {
  log(`Top two picks are close (${a.icon} vs ${b.icon}) — running a direct tie-break...`);
  const client = makeClient(apiKey);
  const response = await client.systemOne({
    state: { title },
    questions: {
      winner: choice(`Which icon better represents a UI section titled '${title}'?`, {
        [a.icon]: a.description,
        [b.icon]: b.description,
      }),
    },
  });
  const pick = response.answers.winner.choice === a.icon ? a : b;
  return { ...pick, confidence: response.answers.winner.confidence };
}

export async function matchIcon(apiKey: string, title: string, log: Logger = () => {}): Promise<MatchResult> {
  const candidates = await shardedFanOut(apiKey, title, log);
  const families = getCandidateCountsByProvider();
  const candidateCount = families.reduce((sum, f) => sum + f.count, 0);
  const shardCount = Math.ceil(candidateCount / CHUNK_SIZE);

  if (candidates.length === 0) {
    log("No shard produced a confident candidate — falling back to a default icon.");
    return { icon: DEFAULT_FALLBACK_ICON, confidence: 0, band: "none", alternatives: [], shardCount, candidateCount, families, tieBroken: false };
  }

  let top = candidates[0];
  let tieBroken = false;
  const second = candidates[1];
  if (second && top.confidence - second.confidence < TIE_BREAK_MARGIN) {
    top = await tieBreak(apiKey, title, top, second, log);
    tieBroken = true;
  }

  return {
    icon: top.icon,
    confidence: top.confidence,
    band: top.confidence >= HIGH_CONFIDENCE ? "high" : "medium",
    alternatives: candidates.slice(0, 3),
    shardCount,
    candidateCount,
    families,
    tieBroken,
  };
}
