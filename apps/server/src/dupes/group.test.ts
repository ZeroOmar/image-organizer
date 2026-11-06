import { describe, expect, it } from 'vitest';
import { groupByKey, groupBySimilarity } from './group.js';
import { dhashWords, hamming } from './hashes.js';

describe('groupByKey', () => {
  it('groups equal keys and drops singles and missing keys', () => {
    expect(groupByKey(['a', 'b', 'a', null, 'c', 'b', 'a'])).toEqual([
      { members: [0, 2, 6], similarity: 1 },
      { members: [1, 5], similarity: 1 },
    ]);
  });
});

describe('groupBySimilarity', () => {
  // Points on a line: similarity falls off with distance.
  const pts = [0, 1, 2, 3, 10, 10.5];
  const sim = (a: number, b: number) => 1 - Math.abs(pts[a] - pts[b]) / 10;

  it('joins items close to the seed and reports the weakest match', () => {
    expect(groupBySimilarity(pts.length, sim, 0.85)).toEqual([
      { members: [0, 1], similarity: 0.9 },
      { members: [2, 3], similarity: 0.9 },
      { members: [4, 5], similarity: 0.95 },
    ]);
  });

  it("doesn't chain: 0~1~2~3 aren't one group when 0 and 3 are far apart", () => {
    const groups = groupBySimilarity(4, sim, 0.75);
    expect(groups[0].members).toEqual([0, 1, 2]);
    expect(groups).toHaveLength(1);
  });
});

describe('hamming', () => {
  it('counts differing bits across both words', () => {
    expect(hamming(dhashWords('ffffffff00000000'), dhashWords('ffffffff00000000'))).toBe(0);
    expect(hamming(dhashWords('ffffffff00000000'), dhashWords('7fffffff00000001'))).toBe(2);
    expect(hamming(dhashWords('0000000000000000'), dhashWords('ffffffffffffffff'))).toBe(64);
  });
});
