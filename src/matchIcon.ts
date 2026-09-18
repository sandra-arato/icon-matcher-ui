import { TypeSafeClient, choice } from "@typesafe-ai/sdk";
import { getAllCandidates } from "./providers";

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
  tieBroken: boolean;
}

export type Logger = (message: string) => void;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Runs entirely in the browser: the API key never leaves this tab except in requests
 * straight to api.typesafe.ai. TypeSafeClient requires `dangerouslyAllowBrowser: true` to
 * acknowledge that — anyone with page access could read the key out of memory/devtools.
 */
function makeClient(apiKey: string) {
  return new TypeSafeClient({ apiKey, dangerouslyAllowBrowser: true });
}

async function shardedFanOut(apiKey: string, title: string, log: Logger): Promise<Candidate[]> {
  const client = makeClient(apiKey);
  const icons = getAllCandidates();
  const shards = chunk(icons, CHUNK_SIZE);

  log(`Sharding ${icons.length} icons (Hugeicons + Lucide) into ${shards.length} parallel Choice questions...`);

  const questions = Object.fromEntries(
    shards.map((shard, i) => [
      `shard_${i}`,
      choice(`Which icon best represents a UI section titled '${title}'?`, {
        ...Object.fromEntries(shard.map((icon) => [icon.qualifiedName, icon.description])),
        [NONE_LABEL]: "No icon in this list fits well",
      }),
    ]),
  );

  const response = await client.systemOne({ state: { title }, questions });
  log(`Response received — ${Object.keys(response.answers).length} shard answers.`);

  const byName = new Map(icons.map((i) => [i.qualifiedName, i.description]));
  const candidates: Candidate[] = [];
  for (const answer of Object.values(response.answers)) {
    if (answer.choice === NONE_LABEL) continue;
    candidates.push({
      icon: answer.choice,
      description: byName.get(answer.choice) ?? answer.choice,
      confidence: answer.confidence,
    });
  }
  candidates.sort((a, b) => b.confidence - a.confidence);
  return candidates;
}

async function tieBreak(apiKey: string, title: string, a: Candidate, b: Candidate, log: Logger): Promise<Candidate> {
  log(`Top two shard picks are close (${a.icon} vs ${b.icon}) — running a direct tie-break...`);
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

  if (candidates.length === 0) {
    log("No shard produced a confident candidate — falling back to a default icon.");
    return {
      icon: DEFAULT_FALLBACK_ICON,
      confidence: 0,
      band: "none",
      alternatives: [],
      shardCount: Math.ceil(getAllCandidates().length / CHUNK_SIZE),
      candidateCount: getAllCandidates().length,
      tieBroken: false,
    };
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
    shardCount: Math.ceil(getAllCandidates().length / CHUNK_SIZE),
    candidateCount: getAllCandidates().length,
    tieBroken,
  };
}
