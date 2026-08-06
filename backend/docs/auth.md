# Customer authentication

Phone number plus a one-time code. No password.

**Super admins are separate and keep email + password**, deliberately — the
operator console must not depend on the same delivery path as customers, or one
SMS outage locks you out of your own platform.

---

## 1. The flow

```
POST /api/auth/otp          { phone }        → sends a code
POST /api/auth/otp/verify   { phone, code }  → { token, profileComplete, isNew }
GET  /api/auth/business-categories            (public, for the profile form)
PUT  /api/auth/profile      (auth)            completes or edits the profile
GET  /api/auth/me           (auth)
```

**Signing up and signing in are the same request.** A phone number either has an
account or gets one, which removes the "already registered?" fork and with it the
class of problem where someone creates a second account because they typed a
different spelling of their email.

Verification returns **`profileComplete`**, and the client routes on it —
`/dashboard` or `/onboarding`. The server decides, because the client should not be
inferring set-up state from whichever fields it happens to have loaded.
`ProtectedRoute` enforces the same thing on every navigation, so an abandoned
signup reopened from a bookmark lands on the form rather than on a dashboard of
zeroes.

A brand-new number gets a `Tenant` immediately, with an empty `businessName` and
`onboardingCompletedAt` unset. Creating the workspace up front is what keeps
`User.tenantId` required — a half-registered user with no tenant would reach
tenant-scoped code with nothing to scope to. The name is left **blank** rather than
given a plausible default like "My Business": a blank field asks to be completed, a
default gets left alone and then appears on an invoice.

---

## 2. Delivery, and the development escape hatch

`OTP_ECHO=true` returns the code in the API response so local testing does not
spend real SMS. The login page shows it, labelled, and prefills the field.

**It is a complete authentication bypass** — anyone could request a code for any
number and read it straight back — so it is not a preference the environment can
override:

```ts
const asked = process.env.OTP_ECHO === 'true';
if (asked && process.env.NODE_ENV === 'production') {
  logger.error('OTP_ECHO is set in production and is being IGNORED …');
  return false;
}
```

Set in production it is **refused and logged as an error**, not honoured. A
misconfiguration that disables login entirely is better than one that silently
disables it for everybody's account.

No SMS provider is wired yet. With echo off, requesting a code returns **422 with
an explicit message** rather than pretending to have sent something — a customer
waiting for a code that was never dispatched has no way to tell the difference.
Plugging in MSG91 or Twilio is one function: `deliver()` in
`services/otp.service.ts`.

| Variable | Default | Notes |
|---|---|---|
| `OTP_ECHO` | unset | Dev only. Refused in production. |
| `OTP_TTL_MINUTES` | `10` | |
| `OTP_MAX_ATTEMPTS` | `5` | Wrong guesses before the challenge burns |
| `OTP_MAX_PER_HOUR` | `5` | Per **phone**, enforced in the database |
| `OTP_RESEND_COOLDOWN_SECONDS` | `45` | |

---

## 3. Why the code is treated as a credential

- **Hashed at rest** (bcrypt). A database dump must not be a list of live login
  codes.
- **Attempt-limited.** A 6-digit code is 10⁶, which is nothing if it can be guessed
  at leisure — so the challenge burns after `OTP_MAX_ATTEMPTS`, not only on expiry.
- **Single-use**, and only one is live at a time: requesting a new code retires the
  previous one rather than doubling the guessing surface.
- **Generated with `randomInt`**, not `Math.random()`.
- **Requesting one reveals nothing.** The response is identical whether or not the
  number has an account, and verification gives one message for wrong / expired /
  none-outstanding — otherwise the endpoint is a way to test a leaked phone list
  against our customer list. Verification hashes even when there is no challenge,
  so a missing account is not detectable from response time either.
- **Per-phone hourly cap lives in the database**, not an in-memory limiter: the
  abuse it stops is spending our SMS balance on somebody else's handset, and that
  attacker rotates IPs freely. Per-IP limiters sit on the routes as well.
- **A failed send costs the customer nothing.** If delivery throws, the challenge
  is deleted, so a provider outage does not also spend their cooldown and hourly
  quota.

---

## 4. Country

Derived from the phone's **E.164 calling code**, not from an IP lookup. The phone is
already the identifier, so this needs no external service, no egress call and no
request-level geolocation — and it is right when someone signs up over a VPN or
while travelling, which is exactly when an IP is wrong.

Longest prefix wins (`1` is US/Canada, `1242` is the Bahamas). Unknown returns
`null` rather than a guess, and `normalisePhone` never infers a missing country
code: the same local number exists in dozens of countries, and guessing is how
someone signs in as a stranger.

Stored on `User.country` for future use — tax, pricing and locale all want it — and
it pre-fills the billing address country.

---

## 5. What the profile form asks for, and what it does not

Business name · category · contact number · website · full name · **optional**
email.

- **No password.** The number is the identifier and a code is the credential.
- **No address.** Nobody signing up knows or cares yet; it is needed at the moment
  they pay, so it is collected on the **billing page** as the billing address and
  frozen onto each invoice at issue. Four fields between a person and the product
  is four reasons to close the tab.
- **Email is optional and stays optional.** Nothing signs in with it, so requiring
  it would be asking for a detail purely to have it. Unique when present. An address
  entered here is marked unverified — claiming otherwise would let someone assert an
  address they do not control.

### Categories come from the database

Was a Prisma enum, so adding "Pharmacy" meant a migration and a deploy. Now the
`BusinessCategory` table, managed in the operator console under **Categories**.

**`key` is what code matches on** — workflow templates declare
`suitedTo: ['RESTAURANT']` and the AI router is told the category — so it is
immutable after creation; renaming one would silently stop those templates being
offered to the workspaces they were written for. The label changes freely.

A category with workspaces on it is **deactivated, never deleted**: deleting would
null their `businessCategoryId` and quietly change which templates they are offered.

> The old enum still exists as `BusinessCategoryLegacy`, because dropping a column
> is not an additive migration. `Tenant.category` is **never read** — for a
> workspace on a category added since, it holds a meaningless default.
