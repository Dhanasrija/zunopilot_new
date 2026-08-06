import { describe, expect, it } from 'vitest';
import { tintFor } from './categorical-tint';

// The two properties this helper exists for, and one that protects it from Tailwind.
//
// Neither of the first two is obvious from reading the function: both are about what it must
// *never* do, and a hash that quietly stopped being stable — or started returning a semantic
// colour — would look completely fine in review.

describe('a person keeps their colour', () => {
  it('returns the same classes for the same seed, every time', () => {
    // The point of the whole helper. If this drifts, a customer changes colour between the
    // Customers table and the Inbox, and the avatar stops being a recognition cue at all.
    const first = tintFor('cus_a1b2c3');
    for (let i = 0; i < 50; i += 1) expect(tintFor('cus_a1b2c3')).toBe(first);
  });

  it('ignores case and surrounding whitespace', () => {
    expect(tintFor('  Asha  ')).toBe(tintFor('asha'));
  });

  it('gives an empty, null or undefined seed one stable colour rather than throwing', () => {
    // A customer with no id is not a crash. All three collapse to the same 'unknown' bucket.
    const blank = tintFor('');
    expect(tintFor(null)).toBe(blank);
    expect(tintFor(undefined)).toBe(blank);
    expect(tintFor('   ')).toBe(blank);
  });
});

describe('the colours it is allowed to use', () => {
  it('only ever returns one of the six categorical pairs', () => {
    const allowed = new Set([1, 2, 3, 4, 5, 6].map((n) => `bg-chart-${n}/15 text-chart-ink-${n}`));
    for (let i = 0; i < 500; i += 1) {
      expect(allowed.has(tintFor(`seed-${i}`))).toBe(true);
    }
  });

  it('**never returns a semantic colour**', () => {
    /*
     * `success` and `danger` on an avatar would say this customer is in a good or bad state,
     * which is `StatusPill`'s job and not a hash's. The scale is deliberately six hues at one
     * lightness so that no bucket reads as more important than another.
     */
    for (let i = 0; i < 200; i += 1) {
      const classes = tintFor(`seed-${i}`);
      expect(classes).not.toMatch(/success|danger|warning|wa-green/);
    }
  });

  it('pairs each tint with its own AA-solved ink, never the same-numbered chart colour', () => {
    // `text-chart-N` on `bg-chart-N/15` measures 3.4:1 and fails §2.4; `chart-ink-N` is the
    // same hue solved for AA. Returning the pair together is what stops the failing
    // combination being assembled by hand at the call site.
    for (let i = 0; i < 200; i += 1) {
      const [bg, text] = tintFor(`seed-${i}`).split(' ');
      const n = bg.match(/bg-chart-(\d)\/15/)?.[1];
      expect(text).toBe(`text-chart-ink-${n}`);
    }
  });

  it('spreads seeds across all six buckets rather than clustering', () => {
    // A sum-of-char-codes hash puts short names in the low buckets and gives anagrams the same
    // colour. FNV-1a does not, and this is the cheap check that it has not been swapped out.
    const seen = new Set(Array.from({ length: 300 }, (_, i) => tintFor(`customer-${i}`)));
    expect(seen.size).toBe(6);
  });

  it('**depends on the order of the characters, not just which ones they are**', () => {
    /*
     * This is the test that found a real flaw, so it is worth saying what it is testing and
     * what the first version of it got wrong.
     *
     * First version: "these three anagram pairs must not all collide". All three did. That
     * looked like bad luck — 1-in-200 — but it was not: `bucketFor` ended `Math.abs(hash) % 6`,
     * and `% 6` includes `% 2`. FNV-1a's lowest bit is `parity(offset) XOR parity(c₁) XOR …`,
     * which reordering cannot change, so every set of anagrams could only ever reach three of
     * the six buckets. The fix takes the high bits instead; see the note in the source.
     *
     * That first version was also a bad test regardless of the outcome — with six buckets any
     * given pair collides 17% of the time, so it was measuring luck and would have gone red on
     * an innocent change. This one is deterministic: enumerate *every* permutation of a word
     * and require the full scale to be reachable. Under the old hash this is 3; it cannot pass
     * by chance, and it cannot fail by chance either.
     */
    const permutations = (word: string): string[] => {
      if (word.length < 2) return [word];
      return word.split('').flatMap((char, i) =>
        permutations(word.slice(0, i) + word.slice(i + 1)).map((rest) => char + rest));
    };

    for (const word of ['asha', 'ravi', 'meera']) {
      const reached = new Set([...new Set(permutations(word))].map(tintFor));
      expect(reached.size, `permutations of "${word}" should reach all six buckets`).toBe(6);
    }
  });
});
