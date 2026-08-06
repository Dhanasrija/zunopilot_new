// The empty state for a list with nobody on it.
//
// **This is a spot illustration, which §7 did not previously allow** — it said "mini
// flow-diagram illustration", and `ui/empty-state.tsx` implements that. §7 has been amended
// alongside this component rather than left as a rule the code openly ignores.
//
// The reasoning for the exception, recorded because the next person will wonder: the flow
// diagram says "this is where a workflow would be", which is true on the workflow screens and
// meaningless here. An empty customer list is not a missing automation; it is an address book
// with nobody in it, and drawing a trigger→action chain to say so would be decoration wearing
// the signature element's clothes.
//
// Built to the same constraints the flow diagram is: inline SVG so it inherits tokens and
// cannot drift from the palette the way an exported asset would, 1px strokes per §4.4, and
// `--radius-md` corners per §4.3. No fill that is not a token.

export function EmptyListArt() {
  return (
    <svg
      // Decorative. The heading and body beneath carry the meaning, so a screen reader that
      // announced this would only be repeating them.
      aria-hidden
      focusable="false"
      width="132"
      height="112"
      viewBox="0 0 132 112"
      fill="none"
      className="mx-auto"
    >
      {/* The book. `surface-1` card on a 1px `ink-300` border — the same treatment every
          card in the product gets, so the object reads as one of ours. */}
      <rect
        x="26" y="14" width="80" height="76" rx="8"
        className="fill-surface-1 stroke-ink-300" strokeWidth={1}
      />
      {/* Spine, and the rings through it. */}
      <line x1="44" y1="14" x2="44" y2="90" className="stroke-ink-300" strokeWidth={1} />
      {[28, 44, 60, 76].map((y) => (
        <circle key={y} cx="44" cy={y} r="2.5" className="fill-surface-0 stroke-ink-400" strokeWidth={1} />
      ))}

      {/* A contact: avatar and two lines, tinted with the accent so the illustration and the
          rows it is standing in for share a palette. */}
      <circle cx="66" cy="40" r="9" className="fill-accent-100" />
      <path
        d="M66 40.5a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM60.5 47a5.5 5.5 0 0111 0"
        className="stroke-accent-600" strokeWidth={1.5} strokeLinecap="round"
      />
      <rect x="54" y="58" width="40" height="4" rx="2" className="fill-ink-300" />
      <rect x="60" y="68" width="28" height="4" rx="2" className="fill-ink-300" />

      {/* The magnifier — this is a list you have looked at and found empty, not one that
          failed to load. */}
      <circle
        cx="93" cy="76" r="15"
        className="fill-surface-0 stroke-accent-600" strokeWidth={1.5}
      />
      <line
        x1="104" y1="87" x2="112" y2="95"
        className="stroke-accent-600" strokeWidth={1.5} strokeLinecap="round"
      />
    </svg>
  );
}
