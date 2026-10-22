import path from "node:path";

// A folder renamed (or a file moved) on the same drive keeps each file's size and modification
// time; only the path changes. The scan recognizes those files by what they kept and moves their
// catalog entries instead of reading them again as new videos.

export type CompletedEntry = number | { modifiedAtMs: number; sizeBytes: number };

function candidateKey(sizeBytes: number, modifiedAtMs: number, relativePath: string): string {
  return `${sizeBytes}:${modifiedAtMs}:${path.posix.extname(relativePath).toLowerCase()}`;
}

export class MoveCandidates {
  private readonly byKey = new Map<string, string[]>();

  // completed: what earlier scans of this drive catalogued, by relative path.
  constructor(completed: Record<string, CompletedEntry>) {
    for (const [relativePath, entry] of Object.entries(completed)) {
      // Entries from old builds keep only the time: not enough to tell one file from another.
      if (typeof entry !== "object" || entry.sizeBytes <= 0) continue;
      const key = candidateKey(entry.sizeBytes, entry.modifiedAtMs, relativePath);
      const paths = this.byKey.get(key);
      if (paths) paths.push(relativePath);
      else this.byKey.set(key, [relativePath]);
    }
  }

  // Old paths the file now at relativePath may have come from. The caller keeps only those that
  // are gone from the drive: an old path that still exists means a copy, not a move.
  candidates(relativePath: string, sizeBytes: number, modifiedAtMs: number): string[] {
    return (this.byKey.get(candidateKey(sizeBytes, modifiedAtMs, relativePath)) ?? []).filter((item) => item !== relativePath);
  }
}

// to: a path new to the catalog; gone: old paths of the same size, time and extension that are no
// longer on the drive.
export type MoveProposal = { to: string; gone: string[] };

type Score = [folderVotes: number, sameName: number];

function compareScores(a: Score, b: Score): number {
  return a[0] - b[0] || a[1] - b[1];
}

// Decides, once the whole drive was walked, which old path each new path came from (new -> old).
// A renamed folder moves many files the same way, so every proposal votes for the folder change
// it implies ("Testing" -> "Testing 2024"); the change with more votes wins, then the same file
// name. A tie (a folder renamed and also copied, two files with the same name) moves nothing:
// those files are scanned as new, as before.
export function resolveMoves(proposals: MoveProposal[]): Map<string, string> {
  const folderChange = (from: string, to: string) => `${path.posix.dirname(from)}\n${path.posix.dirname(to)}`;
  const votes = new Map<string, number>();
  for (const proposal of proposals) {
    for (const from of proposal.gone) {
      const key = folderChange(from, proposal.to);
      votes.set(key, (votes.get(key) ?? 0) + 1);
    }
  }

  type Pair = { to: string; from: string; score: Score };
  const pairs: Pair[] = proposals.flatMap((proposal) => proposal.gone.map((from) => ({
    to: proposal.to,
    from,
    score: [
      votes.get(folderChange(from, proposal.to)) ?? 0,
      path.posix.basename(from).toLowerCase() === path.posix.basename(proposal.to).toLowerCase() ? 1 : 0
    ] as Score
  })));
  const byTo = new Map<string, Pair[]>();
  const byFrom = new Map<string, Pair[]>();
  for (const pair of pairs) {
    byTo.set(pair.to, [...(byTo.get(pair.to) ?? []), pair]);
    byFrom.set(pair.from, [...(byFrom.get(pair.from) ?? []), pair]);
  }

  const result = new Map<string, string>();
  const doneTo = new Set<string>();
  const doneFrom = new Set<string>();
  for (const pair of [...pairs].sort((a, b) => compareScores(b.score, a.score))) {
    if (doneTo.has(pair.to) || doneFrom.has(pair.from)) continue;
    const free = (other: Pair) => other !== pair && !doneTo.has(other.to) && !doneFrom.has(other.from)
      && compareScores(other.score, pair.score) === 0;
    const rivalForOld = (byFrom.get(pair.from) ?? []).some(free);
    const rivalForNew = (byTo.get(pair.to) ?? []).some(free);
    if (rivalForOld || rivalForNew) {
      // Nobody gets an old path two new paths want equally, nor a new path two old ones fit.
      if (rivalForOld) doneFrom.add(pair.from);
      if (rivalForNew) doneTo.add(pair.to);
      continue;
    }
    result.set(pair.to, pair.from);
    doneTo.add(pair.to);
    doneFrom.add(pair.from);
  }
  return result;
}
