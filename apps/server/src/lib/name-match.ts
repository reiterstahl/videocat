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

// Words of a name: runs of letters or of digits, without case or accents ("GATO_2024" → gato, 2024).
function nameWords(value: string): string[] {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().match(/[a-z]+|[0-9]+/g) ?? [];
}

// A keyword matches only as whole words: GATO, gato, .GATO., "gato 2024.mp4" or Boda-Ana for
// "boda ana"; never gatos, gatito or a one-letter difference. Separators inside the keyword do
// not matter either ("testing001" matches "Testing_001").
export function wordMatch(filename: string, key: string): boolean {
  if (key.length < minSearchKeyLength) return false;
  const words = nameWords(stem(filename));
  for (let start = 0; start < words.length; start += 1) {
    let joined = "";
    for (let end = start; end < words.length && joined.length < key.length; end += 1) {
      joined += words[end];
      if (joined === key) return true;
    }
  }
  return false;
}

// "exact" keys (the extra keywords) match whole words only; the folder name keeps the broad search.
export type SearchKey = { key: string; label: string; exact?: boolean };

// Search keys for a folder: its own name plus optional extra keywords, deduplicated and long enough.
export function searchKeys(folderName: string, keywords: readonly string[] = []): SearchKey[] {
  const keys: SearchKey[] = [];
  [folderName, ...keywords].forEach((label, index) => {
    const key = matchKey(label);
    if (key.length >= minSearchKeyLength && !keys.some((entry) => entry.key === key)) keys.push({ key, label: label.trim(), ...(index > 0 ? { exact: true } : {}) });
  });
  return keys;
}

// Best match among several keys: containing a key beats a one-letter difference; the first key wins ties.
export function bestNameMatch(filename: string, keys: readonly SearchKey[]): { match: NameMatch; keyword: string } | null {
  let similar: { match: NameMatch; keyword: string } | null = null;
  for (const entry of keys) {
    const match = entry.exact ? (wordMatch(filename, entry.key) ? "exact" : null) : nameMatch(filename, entry.key);
    if (match === "exact") return { match, keyword: entry.label };
    if (match === "similar" && !similar) similar = { match, keyword: entry.label };
  }
  return similar;
}
