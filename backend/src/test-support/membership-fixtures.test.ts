import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * Every suite that creates a user must give them a membership.
 *
 * ── Why a static check and not a runtime one ──────────────────────────────────
 *
 * The runtime version exists — `membership-backfill.integration.test.ts` scans the whole database
 * for a login without a membership. It cannot catch a *fixture*: suites delete their tenants in
 * teardown, so an un-synced user is gone before any other file gets to look. That is not a
 * fixable ordering problem; with `fileParallelism: false` there is no moment at which every
 * suite's rows coexist.
 *
 * So this reads the test tree instead. A file that inserts users and never seeds memberships is a
 * file that will start failing with 401 the moment `requireAuth` reads memberships — and it will
 * fail alongside twenty others, so the message will point nowhere useful. Better to say it here,
 * by name, before that happens.
 *
 * Same shape as `openapi.drift.test.ts` and `check-brand.mjs`: a rule about the shape of the
 * codebase, enforced by the build rather than by review.
 */

/*
 * `fileURLToPath`, not `.pathname`.
 *
 * This repository lives under a directory with a space in its name, so `.pathname` hands back the
 * path percent-encoded — `/Venky%20Storage/…` — which `readdirSync` cannot open. It fails as "no
 * test files found", so every check below passes vacuously rather than erroring. The vacuity test
 * at the bottom exists because that is exactly how this was discovered.
 */
const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** Every `*.test.ts` under `src/`. */
const testFiles = (dir: string): string[] => readdirSync(dir).flatMap((entry) => {
  const path = join(dir, entry);
  if (statSync(path).isDirectory()) return testFiles(path);
  return path.endsWith('.test.ts') ? [path] : [];
});

/** Does this file insert users into Postgres? */
const CREATES_USERS = /user\.create|users:\s*\{/;

/** Does it seed memberships for them? */
const SEEDS_MEMBERSHIPS = /seedMemberships|seedUser|syncMembership/;

/**
 * Files that create users and deliberately do not seed memberships.
 *
 * Each needs a reason, because an exemption list with unexplained entries becomes the place people
 * put things to make the check quiet.
 */
const EXEMPT: Record<string, string> = {
  'services/membership-backfill.integration.test.ts':
    'Reads users and memberships as they are. Seeding would be seeding the thing under test.',
  'services/membership.service.integration.test.ts':
    'Creates users *without* memberships on purpose — that is the state `syncMembership` is for, '
    + 'and it deletes any memberships its fixture produced before each test.',
  'test-support/membership-fixtures.test.ts':
    'This file. It matches its own pattern because it contains the pattern as a regex.',
};

describe('test fixtures create memberships, not just users', () => {
  it('**every suite that inserts users seeds their memberships**', () => {
    const offenders: string[] = [];

    for (const path of testFiles(ROOT)) {
      const name = relative(ROOT, path);
      if (name in EXEMPT) continue;

      const source = readFileSync(path, 'utf8');
      if (CREATES_USERS.test(source) && !SEEDS_MEMBERSHIPS.test(source)) offenders.push(name);
    }

    expect(
      offenders,
      'These suites insert users with no membership. They pass today because `requireAuth` reads\n'
      + '`User.tenantId`, and will 401 the moment it reads memberships — all at once, with nothing\n'
      + 'in the failure naming the cause. Add `await seedMemberships(TENANT)` to the fixture, after\n'
      + `the users exist:\n\n  ${offenders.join('\n  ')}\n`,
    ).toEqual([]);
  });

  it('the exemption list has no stale entries', () => {
    // An exemption for a file that no longer exists, or no longer creates users, is a rule nobody
    // is following any more — and the next reader would trust it.
    const present = new Set(testFiles(ROOT).map((path) => relative(ROOT, path)));
    const stale = Object.keys(EXEMPT).filter((name) => !present.has(name));

    expect(stale, `exempted files that are gone: ${stale.join(', ')}`).toEqual([]);
  });

  it('**is not vacuous: it really does find the files that create users**', () => {
    // If the pattern stopped matching anything, the check above would pass forever in silence.
    const creators = testFiles(ROOT)
      .filter((path) => CREATES_USERS.test(readFileSync(path, 'utf8')));

    expect(creators.length).toBeGreaterThan(20);
  });
});
