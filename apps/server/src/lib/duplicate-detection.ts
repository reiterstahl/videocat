import { tagsFromFilename, visualFingerprintBandKeys, visualFingerprintSimilarity } from "@videocat/shared";

export type DuplicateCandidate = {
  id: string;
  filename: string;
  sizeBytes: bigint | number;
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  visualFingerprint: string | null;
};

export type DuplicateMatch = {
  leftId: string;
  rightId: string;
  confidence: number;
  matchType: "same_size" | "visual";
  visualSimilarity: number | null;
  durationDeltaSeconds: number | null;
  reasons: string[];
};

export type DetectedDuplicateGroup = {
  key: string;
  fileIds: string[];
  count: number;
  confidence: number;
  matchType: "same_size" | "visual" | "mixed";
  reasons: string[];
  recoverableBytes: number;
};

function durationTolerance(left: number, right: number): number {
  return Math.max(2.5, Math.max(left, right) * 0.015);
}

function durationScore(left: number | null, right: number | null): { compatible: boolean; score: number; delta: number | null } {
  if (left == null || right == null || left <= 0 || right <= 0) {
    return { compatible: false, score: 0, delta: null };
  }
  const delta = Math.abs(left - right);
  const tolerance = durationTolerance(left, right);
  return { compatible: delta <= tolerance, score: Math.max(0, 1 - (delta / tolerance)), delta };
}

function aspectScore(left: DuplicateCandidate, right: DuplicateCandidate): { compatible: boolean; score: number } {
  if (!left.width || !left.height || !right.width || !right.height) return { compatible: true, score: 0.5 };
  const leftRatio = left.width / left.height;
  const rightRatio = right.width / right.height;
  const difference = Math.abs(leftRatio - rightRatio) / Math.max(leftRatio, rightRatio);
  return { compatible: difference <= 0.06, score: Math.max(0, 1 - (difference / 0.06)) };
}

function filenameScore(left: string, right: string): number {
  const leftTags = new Set(tagsFromFilename(left));
  const rightTags = new Set(tagsFromFilename(right));
  if (leftTags.size === 0 || rightTags.size === 0) return 0;
  const intersection = [...leftTags].filter((tag) => rightTags.has(tag)).length;
  const union = new Set([...leftTags, ...rightTags]).size;
  return union > 0 ? intersection / union : 0;
}

export function compareDuplicateCandidates(left: DuplicateCandidate, right: DuplicateCandidate): DuplicateMatch | null {
  if (left.id === right.id) return null;
  const sameSize = BigInt(left.sizeBytes) === BigInt(right.sizeBytes);
  const duration = durationScore(left.durationSeconds, right.durationSeconds);
  const aspect = aspectScore(left, right);
  const visual = visualFingerprintSimilarity(left.visualFingerprint, right.visualFingerprint);
  const names = filenameScore(left.filename, right.filename);

  if (sameSize) {
    if (visual != null && visual < 0.6) return null;
    const confidence = visual == null
      ? (duration.compatible ? 91 : 86)
      : Math.max(90, Math.round((visual * 72) + (duration.score * 18) + (aspect.score * 5) + (names * 5)));
    return {
      leftId: left.id,
      rightId: right.id,
      confidence: Math.min(100, confidence),
      matchType: "same_size",
      visualSimilarity: visual,
      durationDeltaSeconds: duration.delta,
      reasons: ["Mismo tamaño", ...(visual != null ? ["Contenido visual coincidente"] : []), ...(duration.compatible ? ["Duración coincidente"] : [])]
    };
  }

  if (visual == null || visual < 0.82 || !duration.compatible || !aspect.compatible) return null;
  const confidence = Math.round((visual * 70) + (duration.score * 20) + (aspect.score * 5) + (names * 5));
  if (confidence < 82) return null;
  return {
    leftId: left.id,
    rightId: right.id,
    confidence: Math.min(99, confidence),
    matchType: "visual",
    visualSimilarity: visual,
    durationDeltaSeconds: duration.delta,
    reasons: ["Contenido visual coincidente", "Duración coincidente", "Resolución o compresión diferente"]
  };
}

export function findDuplicateGroups(candidates: DuplicateCandidate[]): DetectedDuplicateGroup[] {
  const parent = new Map(candidates.map((candidate) => [candidate.id, candidate.id]));
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const matches: DuplicateMatch[] = [];

  function find(id: string): string {
    const current = parent.get(id) ?? id;
    if (current === id) return id;
    const root = find(current);
    parent.set(id, root);
    return root;
  }

  function union(left: string, right: string): void {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parent.set(rightRoot, leftRoot);
  }

  const sizeBuckets = new Map<string, DuplicateCandidate[]>();
  for (const candidate of candidates) {
    const key = BigInt(candidate.sizeBytes).toString();
    sizeBuckets.set(key, [...(sizeBuckets.get(key) ?? []), candidate]);
  }

  const comparedPairs = new Set<string>();
  function compare(left: DuplicateCandidate, right: DuplicateCandidate): void {
    const pairKey = left.id < right.id ? `${left.id}:${right.id}` : `${right.id}:${left.id}`;
    if (comparedPairs.has(pairKey)) return;
    comparedPairs.add(pairKey);
    const match = compareDuplicateCandidates(left, right);
    if (!match) return;
    matches.push(match);
    union(left.id, right.id);
  }

  for (const bucket of sizeBuckets.values()) {
    if (bucket.length < 2) continue;
    for (let leftIndex = 0; leftIndex < bucket.length - 1; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < bucket.length; rightIndex += 1) {
        compare(bucket[leftIndex], bucket[rightIndex]);
      }
    }
  }

  const visualCandidates = candidates
    .filter((candidate) => candidate.durationSeconds != null && candidate.visualFingerprint)
    .sort((left, right) => left.durationSeconds! - right.durationSeconds!);
  const activeByBand = new Map<string, Set<string>>();
  const bandsById = new Map<string, string[]>();
  let activeStart = 0;

  for (const candidate of visualCandidates) {
    const maximumDelta = Math.max(2.5, candidate.durationSeconds! * 0.016);
    while (
      activeStart < visualCandidates.length
      && visualCandidates[activeStart].durationSeconds! < candidate.durationSeconds! - maximumDelta
    ) {
      const expired = visualCandidates[activeStart];
      for (const key of bandsById.get(expired.id) ?? []) {
        const bucket = activeByBand.get(key);
        bucket?.delete(expired.id);
        if (bucket?.size === 0) activeByBand.delete(key);
      }
      bandsById.delete(expired.id);
      activeStart += 1;
    }

    const bands = visualFingerprintBandKeys(candidate.visualFingerprint);
    const potentialIds = new Set<string>();
    for (const key of bands) {
      for (const id of activeByBand.get(key) ?? []) potentialIds.add(id);
    }
    for (const id of potentialIds) {
      const potential = byId.get(id);
      if (potential) compare(potential, candidate);
    }
    for (const key of bands) {
      const bucket = activeByBand.get(key) ?? new Set<string>();
      bucket.add(candidate.id);
      activeByBand.set(key, bucket);
    }
    bandsById.set(candidate.id, bands);
  }

  const members = new Map<string, string[]>();
  for (const candidate of candidates) {
    const root = find(candidate.id);
    members.set(root, [...(members.get(root) ?? []), candidate.id]);
  }

  return [...members.values()]
    .filter((fileIds) => fileIds.length > 1)
    .map((fileIds) => {
      const memberSet = new Set(fileIds);
      const groupMatches = matches.filter((match) => memberSet.has(match.leftId) && memberSet.has(match.rightId));
      const matchTypes = new Set(groupMatches.map((match) => match.matchType));
      const files = fileIds.map((id) => byId.get(id)!).filter(Boolean);
      const sizes = files.map((file) => Number(file.sizeBytes));
      return {
        key: [...fileIds].sort().join(":"),
        fileIds,
        count: fileIds.length,
        confidence: Math.round(groupMatches.reduce((sum, match) => sum + match.confidence, 0) / Math.max(1, groupMatches.length)),
        matchType: matchTypes.size > 1 ? "mixed" : (matchTypes.values().next().value ?? "same_size"),
        reasons: [...new Set(groupMatches.flatMap((match) => match.reasons))],
        recoverableBytes: Math.max(0, sizes.reduce((sum, size) => sum + size, 0) - Math.max(...sizes))
      } satisfies DetectedDuplicateGroup;
    })
    .sort((left, right) => right.confidence - left.confidence || right.recoverableBytes - left.recoverableBytes);
}
