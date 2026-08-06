/**
 * Refuse to seed a database that looks like production.
 *
 * **Why this exists.** Every seed script in this directory reads `DATABASE_URL` and writes.
 * `seed-demo-volume.ts` alone inserts 260 customers and 640 orders. Nothing stopped
 * `npm run seed:demo-volume` from being run with a production connection string in the
 * environment — and the failure mode is not an error, it is a live workspace quietly filling
 * with fake customers that look real enough to email.
 *
 * The scripts are careful in other ways: they use `1555…` phone numbers, and most avoid
 * touching pre-existing rows. That is a convention about *what* they write, not about *where*.
 *
 * **Two independent signals, because either alone is unreliable.** `NODE_ENV` is set nowhere
 * in this repository, so its absence proves nothing. The database host is the fact that
 * actually matters, and it is the one an operator cannot forget to set — it is in the
 * connection string they are already using.
 *
 * The override is deliberately verbose. Seeding production is occasionally legitimate — the
 * connector-type catalogue and the super admin account both have to exist there — so this is a
 * speed bump with a named intent, not a wall.
 */

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0', 'host.docker.internal']);

const hostOf = (url: string): string | null => {
  try {
    // `postgresql://` is not a URL scheme `new URL` knows how to give a host for in every
    // runtime, but swapping it for http: makes the rest of the parse identical.
    return new URL(url.replace(/^postgres(ql)?:/, 'http:')).hostname || null;
  } catch {
    return null;
  }
};

export interface SeedGuardOptions {
  /** Shown in the refusal, so the operator knows which script stopped. */
  script: string;
}

/**
 * Throws unless this database is safe to seed.
 *
 * Call it first, before opening a client or reading any input.
 */
export const assertSeedable = ({ script }: SeedGuardOptions): void => {
  if (process.env.I_KNOW_THIS_IS_PRODUCTION === 'true') {
    // Say it out loud. An operator who meant this sees confirmation; one who inherited the
    // variable from a shell they forgot about gets a chance to notice.
    console.warn(
      `[${script}] I_KNOW_THIS_IS_PRODUCTION=true — running against `
      + `${hostOf(process.env.DATABASE_URL ?? '') ?? 'an unparseable host'} anyway.`,
    );
    return;
  }

  const reasons: string[] = [];

  if (process.env.NODE_ENV === 'production') {
    reasons.push('NODE_ENV=production');
  }

  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(`[${script}] DATABASE_URL is not set; refusing to guess at a database.`);
  }
  const host = hostOf(url);
  if (host === null) {
    reasons.push('DATABASE_URL could not be parsed, so its host cannot be checked');
  } else if (!LOCAL_HOSTS.has(host)) {
    reasons.push(`the database host is ${host}, which is not local`);
  }

  if (reasons.length) {
    throw new Error(
      `[${script}] refusing to run: ${reasons.join('; ')}.\n`
      + 'Seed scripts write test data and are meant for a development database. If this really '
      + 'is intended, re-run with I_KNOW_THIS_IS_PRODUCTION=true.',
    );
  }
};
