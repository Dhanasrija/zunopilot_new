// Giving a name or a tag a stable colour.
//
// Two rules make this useful rather than decorative:
//
//   1. **Stable.** The same customer is the same colour on every visit and on every
//      screen, so the avatar becomes a weak recognition cue while scanning a list.
//      A random colour per render would be worse than no colour at all.
//   2. **Categorical, never semantic.** `chart-1..6` exist precisely for this — six
//      hues 60° apart at constant lightness and chroma, so no colour reads as more
//      important than another. Using `success` or `danger` here would imply a
//      customer is in a good or bad state, which is what `StatusPill` is for.

/** How many hues the categorical scale has. See `chart` in tailwind.config.js. */
const SCALE = 6;

/**
 * A stable 1..6 for any string.
 *
 * FNV-1a rather than a sum of char codes: a plain sum gives anagrams the same
 * colour and clusters short names into the low buckets, so "Asha" and "Ashan"
 * would collide far more often than chance.
 *
 * **The bucket comes from the high bits, and that is not a style choice.** This
 * used to end `(Math.abs(hash) % SCALE) + 1`, and `% 6` includes `% 2` — so it
 * inherited FNV-1a's *lowest* bit, which is order-independent. The prime is odd,
 * and parity survives an odd multiply unchanged, so the final low bit is just
 * `parity(offset) XOR parity(c₁) XOR … XOR parity(cₙ)`: rearranging the
 * characters cannot change it. Every set of anagrams therefore landed in only
 * three of the six buckets and collided at 33% against a 17% baseline — the
 * exact clustering the comment above says FNV-1a was chosen to avoid.
 *
 * Scaling the unsigned value by its full range uses the top bits instead, which
 * do depend on order. Anagram collisions drop to 17.3%, and the spread over
 * unrelated seeds is unchanged (it was always even — the flaw was correlation
 * between related seeds, not a lumpy distribution).
 */
const bucketFor = (seed: string): number => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return Math.floor(((hash >>> 0) / 0x100000000) * SCALE) + 1;
};

/**
 * Tailwind classes for a tinted chip: 15% background, matching darker text.
 *
 * The pairing is not arbitrary. `chart-N` text on a 15% `chart-N` tint measures
 * 3.4:1 at worst and fails §2.4; `chart-ink-N` is the same hue solved for AA
 * (5.11:1 worst case). Returning both together is what stops someone reaching for
 * the obvious-but-failing combination.
 *
 * Written as whole class names rather than assembled from fragments, because
 * Tailwind scans source text and would purge `bg-chart-${n}/15`.
 */
const CHIP: Record<number, string> = {
  1: 'bg-chart-1/15 text-chart-ink-1',
  2: 'bg-chart-2/15 text-chart-ink-2',
  3: 'bg-chart-3/15 text-chart-ink-3',
  4: 'bg-chart-4/15 text-chart-ink-4',
  5: 'bg-chart-5/15 text-chart-ink-5',
  6: 'bg-chart-6/15 text-chart-ink-6',
};

export const tintFor = (seed: string | null | undefined): string =>
  CHIP[bucketFor((seed ?? '').trim().toLowerCase() || 'unknown')];
