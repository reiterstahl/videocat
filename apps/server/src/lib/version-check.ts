const stableVersionPattern = /^v?(\d+)\.(\d+)\.(\d+)$/;

type StableVersion = {
  major: number;
  minor: number;
  patch: number;
};

function parseStableVersion(value: string): StableVersion | null {
  const match = value.trim().match(stableVersionPattern);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3])
  };
}

function normalizedVersion(version: StableVersion): string {
  return `${version.major}.${version.minor}.${version.patch}`;
}

export function compareStableVersions(left: string, right: string): number {
  const leftVersion = parseStableVersion(left);
  const rightVersion = parseStableVersion(right);
  if (!leftVersion || !rightVersion) return 0;

  return leftVersion.major - rightVersion.major
    || leftVersion.minor - rightVersion.minor
    || leftVersion.patch - rightVersion.patch;
}

export function latestStableVersion(tags: string[]): string | null {
  const versions = tags
    .map(parseStableVersion)
    .filter((version): version is StableVersion => version !== null)
    .sort((left, right) => right.major - left.major || right.minor - left.minor || right.patch - left.patch);
  return versions[0] ? normalizedVersion(versions[0]) : null;
}
