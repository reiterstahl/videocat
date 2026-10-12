// "Agrupar archivos" compares names after dropping case, accents, dots, spaces and separators,
// so testing001, Testing001, .Testing001, testing_001 and "Testing 001" are the same name.
export function matchKey(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

export const minSearchKeyLength = 3;
// Shorter names would match far too much with one letter of difference.
export const minFuzzyKeyLength = 5;

export type NameMatch = "exact" | "similar";

function stem(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot > 0 ? filename.slice(0, dot) : filename;
}

// True when a and b differ by at most one substitution, insertion or deletion.
export function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (long.length - short.length > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < short.length && j < long.length) {
    if (short[i] === long[j]) {
      i += 1;
      j += 1;
      continue;
    }
    edits += 1;
    if (edits > 1) return false;
    if (short.length === long.length) i += 1;
    j += 1;
  }
  return edits + (long.length - j) - (short.length - i) <= 1;
}

export function nameMatch(filename: string, key: string): NameMatch | null {
  if (key.length < minSearchKeyLength) return null;
  const name = matchKey(stem(filename));
  if (name.includes(key)) return "exact";
  if (key.length < minFuzzyKeyLength) return null;
  // One edit touches at most one half of the key, so the other half appears unchanged.
  const half = Math.floor(key.length / 2);
  if (!name.includes(key.slice(0, half)) && !name.includes(key.slice(half))) return null;
  // The letter of difference is never a digit: testing002 is another project, not a typo.
  const digits = key.replace(/\D/g, "");
  for (const length of [key.length - 1, key.length, key.length + 1]) {
    for (let start = 0; start + length <= name.length; start += 1) {
      const window = name.slice(start, start + length);
      if (window.replace(/\D/g, "") === digits && withinOneEdit(window, key)) return "similar";
    }
  }
  return null;
}
