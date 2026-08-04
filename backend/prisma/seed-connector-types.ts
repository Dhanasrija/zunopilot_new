import { PrismaClient } from '@prisma/client';

// The connector type catalog.
//
// Operator-level rather than per-tenant, so this is its own script like
// `seed-superadmin.ts` rather than part of the demo workspace seed.
//
// **Only the two types that already work are seeded here.** Everything else — Razorpay,
// Google Sheets — is a row an operator adds in the console, which is the entire point of
// the catalog: supporting a new system stopped being a deploy.
//
// Idempotent by `key`. Re-running converges the labels and defaults without touching
// `isActive` or `sortOrder`, because an operator may have deliberately hidden or reordered
// one and a seed re-run should not undo that.

const prisma = new PrismaClient();

const TYPES = [
  {
    key: 'http',
    label: 'Custom HTTP API',
    description:
      'Any REST API, reached through the egress guard. You supply the base URL and the '
      + 'credential, then declare the operations you need.',
    kind: 'HTTP' as const,
    // Empty means "offer them all": a custom API authenticates however its owner decided.
    allowedAuthTypes: [] as const,
    defaultBaseUrl: null,
    secretLabel: null,
    usernameLabel: null,
    defaultHeader: null,
    docsUrl: null,
    sortOrder: 10,
  },
  {
    key: 'mock',
    label: 'Mock (fixtures, no network)',
    description:
      'Answered from in-process fixtures, so it never reaches a network and needs no '
      + 'credential. Fixtures are matched on the connector key you choose — `acme_lms` is '
      + 'the one that ships — so this is for demos and testing, not for a real system.',
    kind: 'MOCK' as const,
    allowedAuthTypes: ['NONE'] as const,
    defaultBaseUrl: null,
    secretLabel: null,
    usernameLabel: null,
    defaultHeader: null,
    docsUrl: null,
    sortOrder: 900,
  },
];

const main = async () => {
  for (const type of TYPES) {
    const { key, sortOrder, ...rest } = type;
    const existing = await prisma.connectorType.findUnique({ where: { key } });

    await prisma.connectorType.upsert({
      where: { key },
      // `isActive` and `sortOrder` are absent from the update on purpose — see the note at
      // the top. An operator's own decisions about visibility and ordering survive a re-seed.
      update: { ...rest, allowedAuthTypes: [...rest.allowedAuthTypes] },
      create: { key, sortOrder, ...rest, allowedAuthTypes: [...rest.allowedAuthTypes] },
    });

    console.log(`  ${existing ? 'updated' : 'added  '} ${key.padEnd(8)} ${type.label}`);
  }

  const total = await prisma.connectorType.count();
  console.log(`\n${total} connector type${total === 1 ? '' : 's'} in the catalog.`);
  console.log('Add more in the Super Admin console — Connector types.');
};

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
