import { body } from 'express-validator';

export const updateTenantValidator = [
  body('businessName').optional().trim().isLength({ min: 2 }).withMessage('must be at least 2 characters'),
  /*
   * The category is an **id from the table**, not the legacy enum.
   *
   * `category` accepted only `RESTAURANT` or `ECOMMERCE_GROCERY` — the two values the enum had
   * before categories became rows. So a workspace could not choose IT Services from Settings even
   * though it exists, and the value it did save landed in a column nothing reads any more.
   *
   * The enum body field is deliberately **not** kept as an alias: writing it is what produced
   * eleven workspaces that all claimed to be restaurants.
   */
  /*
   * Checked for *shape* only. The gate is the controller's lookup against the table.
   *
   * This was `isUUID()`, which rejects any id whose version nibble is not 1–8 — including the
   * fixture-style ids this codebase uses for its seeded workspaces (`00000000-…-000000000001` is
   * Demo Biryani House) and anything a future uuid v7 or a data import might produce. A format rule
   * that can refuse an id the database is legitimately holding is a liability, and it buys nothing
   * here: an id that is not a real, active category is refused a few lines later by a query, which
   * cannot be fooled by a well-formed string.
   */
  body('businessCategoryId').optional({ values: 'null' }).isString().isLength({ min: 1, max: 64 })
    .withMessage('must be a category id'),
  body('contactNumber').optional().isString().withMessage('must be a valid string'),
  body('address').optional().isString().withMessage('must be a valid string'),
  /*
   * ── An empty string is "clear this", not "an invalid URL" ────────────────────
   *
   * `.optional()` treats only `undefined` as absent. The Settings form sends the whole profile on
   * every save, so a workspace with no logo sent `logoUrl: ''` — which is *present* — and
   * `isURL('')` fails. **The result was that Save Changes returned 400 for any workspace that had
   * not set a logo, which is most of them**, and the message pointed at a field the person had not
   * touched. Found while testing the category picker, which could not be saved either.
   *
   * `values: 'falsy'` makes an empty string absent for validation; the controller turns it into
   * `null`, so clearing a field works rather than storing `''` and reading back as a broken link.
   */
  body('website').optional({ values: 'falsy' }).isURL().withMessage('must be a valid URL'),
  body('logoUrl').optional({ values: 'falsy' }).isURL().withMessage('must be a valid URL'),
  // Both switches accept a real boolean or its string form, because a form post sends strings.
  // `isBoolean` with no options rejects `"true"`, which is exactly what an HTML form sends, so
  // the controller does the strict coercion and this only rejects values that are neither.
  body('aiAgentEnabled').optional().isBoolean({ strict: false }).withMessage('must be true or false'),
  body('maskCustomerNumbers').optional().isBoolean({ strict: false }).withMessage('must be true or false'),
];
