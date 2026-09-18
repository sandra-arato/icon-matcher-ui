import { TypeSafeClient, choice } from "@typesafe-ai/sdk";
import { getAllCandidates, getCandidateCountsByProvider, type QualifiedIcon, type FamilyCount } from "./providers";

const CHOICE_OPTION_CAP = 240; // stays under the Choice primitive's hard 255-option-per-question cap
const NONE_LABEL = "none_of_these";
const TIE_BREAK_MARGIN = 0.15; // if the top two picks are this close, run a direct tie-break
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
 * TypeSafe rejects a request as too large (`error_type: "max_tokens_exceeded"`) well before
 * the documented ~32k input-token budget is reached (observed failure: 718 input tokens for
 * one 240-option question, and the same error even for a single such question on its own).
 * The real ceiling isn't documented, so rather than guess it, this detects the rejection and
 * bisects — on whichever axis still has room to shrink — until requests fit.
 */
function isTooManyOptionsError(err: unknown): boolean {
  const message = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return message.includes("max_tokens_exceeded") || message.includes("token") || message.includes("too many") || message.includes("too large");
}

/** Largest option count known to fit in a single Choice question, and in one call's combined total. Discovered once, reused after that. */
let maxOptionsPerQuestion: number | null = null;
let maxOptionsPerCall: number | null = null;
let calibration: Promise<void> | null = null;

function totalOptions(groups: QualifiedIcon[][]): number {
  return groups.reduce((sum, g) => sum + g.length, 0);
}

/**
 * Runs once (subsequent calls reuse the same in-flight promise, or the cached result) to find
 * a safe request size via a single serial probe, halving on failure. Without this, every one
 * of the ~37 shards would independently rediscover the same limit in parallel on a cold
 * start — hundreds of redundant failing calls instead of a handful of serial ones.
 */
async function calibrate(client: TypeSafeClient, sample: QualifiedIcon[], title: string, log: Logger): Promise<void> {
  if (maxOptionsPerQuestion !== null) return;
  if (!calibration) {
    calibration = (async () => {
      let size = Math.min(CHOICE_OPTION_CAP, sample.length);
      for (;;) {
        const probe = sample.slice(0, size);
        const questions = {
          q_0: choice(`Which icon best represents a UI section titled '${title}'?`, {
            ...Object.fromEntries(probe.map((icon) => [icon.qualifiedName, icon.description])),
            [NONE_LABEL]: "No icon in this list fits well",
          }),
        };
        try {
          await client.systemOne({ state: { title }, questions });
          maxOptionsPerQuestion = size;
          maxOptionsPerCall = size;
          log(`Calibrated: up to ${size} options fit in a single Choice question/call.`);
          return;
        } catch (err) {
          if (!isTooManyOptionsError(err) || size <= 1) throw err;
          const next = Math.max(1, Math.floor(size / 2));
          log(`Calibrating request size — ${size} options hit TypeSafe's size limit, trying ${next}...`);
          size = next;
        }
      }
    })();
  }
  await calibration;
}

/**
 * `groups` is one Choice question per array. On a size error this bisects along whichever
 * axis still has room: split into fewer questions per call if there's more than one group,
 * or split a single group's own option list in half if there's only one left. Either way it
 * retries both halves in parallel and merges the results.
 */
async function runBatch(client: TypeSafeClient, groups: QualifiedIcon[][], title: string, log: Logger): Promise<Candidate[]> {
  const byName = new Map(groups.flat().map((i) => [i.qualifiedName, i.description]));
  const questions = Object.fromEntries(
    groups.map((group, i) => [
      `q_${i}`,
      choice(`Which icon best represents a UI section titled '${title}'?`, {
        ...Object.fromEntries(group.map((icon) => [icon.qualifiedName, icon.description])),
        [NONE_LABEL]: "No icon in this list fits well",
      }),
    ]),
  );

  try {
    const response = await client.systemOne({ state: { title }, questions });
    maxOptionsPerQuestion = Math.max(maxOptionsPerQuestion ?? 0, ...groups.map((g) => g.length));
    maxOptionsPerCall = Math.max(maxOptionsPerCall ?? 0, totalOptions(groups));

    const candidates: Candidate[] = [];
    for (const answer of Object.values(response.answers)) {
      if (answer.choice === NONE_LABEL) continue;
      candidates.push({ icon: answer.choice, description: byName.get(answer.choice) ?? answer.choice, confidence: answer.confidence });
    }
    return candidates;
  } catch (err) {
    if (!isTooManyOptionsError(err)) throw err;

    const single = groups.length === 1 ? groups[0] : null;
    if (groups.length === 1 && (single as QualifiedIcon[]).length <= 1) throw err; // can't shrink further

    let left: QualifiedIcon[][];
    let right: QualifiedIcon[][];
    if (groups.length > 1) {
      const mid = Math.ceil(groups.length / 2);
      left = groups.slice(0, mid);
      right = groups.slice(mid);
      maxOptionsPerCall = maxOptionsPerCall ? Math.min(maxOptionsPerCall, totalOptions(left)) : totalOptions(left);
      log(`${groups.length} questions (${totalOptions(groups)} options) in one call hit TypeSafe's size limit — splitting into ${left.length} + ${right.length} questions and retrying...`);
    } else {
      const group = single as QualifiedIcon[];
      const mid = Math.ceil(group.length / 2);
      left = [group.slice(0, mid)];
      right = [group.slice(mid)];
      maxOptionsPerQuestion = maxOptionsPerQuestion ? Math.min(maxOptionsPerQuestion, mid) : mid;
      log(`A single Choice question with ${group.length} options hit TypeSafe's size limit — splitting into ${mid} + ${group.length - mid} options and retrying...`);
    }

    const [a, b] = await Promise.all([
      runBatch(client, left, title, log),
      runBatch(client, right, title, log),
    ]);
    return [...a, ...b];
  }
}

async function shardedFanOut(apiKey: string, title: string, log: Logger): Promise<Candidate[]> {
  const client = makeClient(apiKey);
  const icons = getAllCandidates();

  await calibrate(client, icons, title, log);

  const groupSize = Math.min(CHOICE_OPTION_CAP, maxOptionsPerQuestion ?? CHOICE_OPTION_CAP);
  const groups = chunk(icons, groupSize);
  const groupsPerCall = maxOptionsPerCall ? Math.max(1, Math.floor(maxOptionsPerCall / groupSize)) : groups.length;
  const calls = chunk(groups, groupsPerCall);

  log(`Sharding ${icons.length} icons (Hugeicons + Lucide) into ${groups.length} Choice questions across ${calls.length} call(s)...`);

  const results = await Promise.all(calls.map((call) => runBatch(client, call, title, log)));
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
  const shardCount = Math.ceil(candidateCount / CHOICE_OPTION_CAP);

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
