/** Groups of item indexes (2+ members) and how alike the least similar member is to the first (0–1). */
export interface IndexGroup {
  members: number[];
  similarity: number;
}

/** Items with an equal key (e.g. the same SHA-256). Items without a key are skipped. */
export function groupByKey(keys: (string | null | undefined)[]): IndexGroup[] {
  const by = new Map<string, number[]>();
  keys.forEach((k, i) => {
    if (k == null) return;
    const list = by.get(k);
    if (list) list.push(i);
    else by.set(k, [i]);
  });
  return [...by.values()].filter((m) => m.length > 1).map((members) => ({ members, similarity: 1 }));
}

/**
 * Leader clustering: each unassigned item in order seeds a group, and every later unassigned item
 * whose similarity to the seed is at least `threshold` joins it. Comparing against the seed (not any
 * member) stops chains of look-alikes from merging into one giant group. O(n²) similarity calls.
 */
export function groupBySimilarity(n: number, similarity: (a: number, b: number) => number, threshold: number): IndexGroup[] {
  const assigned = new Uint8Array(n);
  const out: IndexGroup[] = [];
  for (let seed = 0; seed < n; seed++) {
    if (assigned[seed]) continue;
    const members = [seed];
    let min = 1;
    for (let j = seed + 1; j < n; j++) {
      if (assigned[j]) continue;
      const s = similarity(seed, j);
      if (s >= threshold) {
        members.push(j);
        assigned[j] = 1;
        min = Math.min(min, s);
      }
    }
    if (members.length > 1) out.push({ members, similarity: min });
  }
  return out;
}

export function cosine(a: Float32Array, b: Float32Array): number {
  let d = 0;
  for (let k = 0; k < a.length; k++) d += a[k] * b[k];
  return d;
}
