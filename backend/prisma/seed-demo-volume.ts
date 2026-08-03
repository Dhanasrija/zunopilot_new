import { OrderStatus, PrismaClient, Prisma } from '@prisma/client';

// Bulk customers and orders for Demo Biryani House, so the list pages have enough in
// them to exercise pagination, filters and CSV export.
//
//   npx tsx prisma/seed-demo-volume.ts            # create / refresh
//   npx tsx prisma/seed-demo-volume.ts --clean    # remove exactly what it created
//
// **Separate from `seed.ts` on purpose.** That script upserts the owner with
// `OWNER_PHONE = '15550000001'`, and this workspace's owner has since been moved to a
// different sign-in number. Folding volume data into it would mean a re-run could
// revert someone's login, which is not a risk worth taking for test data.
//
// Three rules this script keeps, in order of how much damage breaking them does:
//
//   1. **It never modifies a row it did not create.** Everything it owns is identified
//      by the `waId` prefix below. The five customers already in this workspace include
//      a real phone number, and one of them is a live conversation.
//   2. **Fake numbers only.** The `1555…` range is reserved and unroutable, so nothing
//      here can result in a message to a real person.
//   3. **Re-running changes nothing.** Customers are upserted on `(tenantId, waId)`;
//      orders are deleted and rebuilt from a fixed pseudo-random sequence, so amounts
//      and statuses come out identical. Dates are relative to "now" and so do shift —
//      that is deliberate, otherwise the Today / Yesterday filters would go stale.

const prisma = new PrismaClient();

const TENANT_ID = '00000000-0000-0000-0000-000000000001';

/**
 * Marks every row this script owns.
 *
 * `155520…` rather than a rounder number because `15550008844` and `1555999xxxx` are
 * already in use by other seeds, and `--clean` matches on this prefix — a collision
 * would mean deleting somebody else's fixture.
 */
const WA_PREFIX = '155520';

const CUSTOMER_COUNT = 260;
const ORDER_COUNT = 640;

/**
 * A tiny deterministic generator, so a re-run produces byte-identical amounts and
 * statuses. `Math.random()` would make "idempotent" only true for the row count.
 */
const rng = (seed: number) => {
  let state = seed;
  return () => {
    // Numerical Recipes LCG. Not good randomness; perfectly good repeatability.
    state = (state * 1_664_525 + 1_013_904_223) % 4_294_967_296;
    return state / 4_294_967_296;
  };
};

const pick = <T>(random: () => number, list: readonly T[]): T =>
  list[Math.floor(random() * list.length)]!;

const FIRST = [
  'Aarav', 'Diya', 'Vihaan', 'Ananya', 'Arjun', 'Ishita', 'Reyansh', 'Meera',
  'Kabir', 'Saanvi', 'Vivaan', 'Aditi', 'Rohan', 'Kavya', 'Aryan', 'Nisha',
  'Karthik', 'Priya', 'Rahul', 'Sneha', 'Vikram', 'Divya', 'Sanjay', 'Pooja',
];
const LAST = [
  'Sharma', 'Reddy', 'Nair', 'Iyer', 'Patel', 'Rao', 'Menon', 'Gupta',
  'Kulkarni', 'Chowdhury', 'Verma', 'Pillai', 'Joshi', 'Naidu',
];
const AREAS = [
  'Jubilee Hills', 'Banjara Hills', 'Gachibowli', 'Madhapur', 'Kondapur',
  'Begumpet', 'Secunderabad', 'Kukatpally', 'Ameerpet', 'Himayatnagar',
];

/** Menu the orders are built from. Prices are what the line totals are summed from. */
const MENU: ReadonlyArray<{ category: string; items: ReadonlyArray<[string, number]> }> = [
  {
    category: 'Biryani',
    items: [
      ['Hyderabadi Chicken Biryani', 320],
      ['Mutton Dum Biryani', 420],
      ['Veg Dum Biryani', 240],
      ['Egg Biryani', 260],
    ],
  },
  {
    category: 'Starters',
    items: [
      ['Paneer Tikka', 260],
      ['Chicken 65', 280],
      ['Apollo Fish', 340],
    ],
  },
  {
    category: 'Breads & Rice',
    items: [
      ['Butter Naan', 60],
      ['Tandoori Roti', 40],
      ['Jeera Rice', 180],
    ],
  },
  {
    category: 'Desserts & Drinks',
    items: [
      ['Double Ka Meetha', 120],
      ['Qubani Ka Meetha', 140],
      ['Masala Chaas', 60],
    ],
  },
];

/**
 * Weighted so the board looks like a real day's work rather than a uniform spread:
 * most orders have been delivered, a few are live, a few were cancelled.
 */
const STATUS_WEIGHTS: ReadonlyArray<[OrderStatus, number]> = [
  ['DELIVERED', 55],
  ['NEW', 8],
  ['ACCEPTED', 7],
  ['PREPARING', 8],
  ['READY', 6],
  ['OUT_FOR_DELIVERY', 6],
  ['CANCELLED', 10],
];

const weightedStatus = (random: () => number): OrderStatus => {
  const total = STATUS_WEIGHTS.reduce((sum, [, w]) => sum + w, 0);
  let roll = random() * total;
  for (const [status, weight] of STATUS_WEIGHTS) {
    roll -= weight;
    if (roll <= 0) return status;
  }
  return 'DELIVERED';
};

const clean = async () => {
  const owned = await prisma.customer.findMany({
    where: { tenantId: TENANT_ID, waId: { startsWith: WA_PREFIX } },
    select: { id: true },
  });
  const ids = owned.map((c) => c.id);
  if (!ids.length) {
    console.log('nothing to clean — no customers with the seed prefix');
    return;
  }
  // Orders first even though the relation cascades, so the count is reportable.
  const orders = await prisma.order.deleteMany({ where: { customerId: { in: ids } } });
  const customers = await prisma.customer.deleteMany({ where: { id: { in: ids } } });
  console.log(`removed ${orders.count} orders and ${customers.count} customers`);
  console.log('menu categories and items are left in place — they are plausible data '
    + 'for this workspace and nothing else identifies them as seeded.');
};

const main = async () => {
  const tenant = await prisma.tenant.findUnique({
    where: { id: TENANT_ID },
    select: { businessName: true },
  });
  if (!tenant) {
    // Better than creating one: a missing tenant means the base seed has not been run,
    // and inventing a workspace here would hide that.
    throw new Error(`Tenant ${TENANT_ID} not found. Run \`npm run prisma:seed\` first.`);
  }
  console.log(`workspace: ${tenant.businessName}`);

  if (process.argv.includes('--clean')) {
    await clean();
    return;
  }

  // ── Menu ────────────────────────────────────────────────────────────────────
  // Only three items exist, which would make 640 orders look like the same order 640
  // times. Matched by name because neither table has a unique constraint to upsert on.
  const itemsByPrice: Array<{ id: string; name: string; price: number }> = [];

  for (const [index, group] of MENU.entries()) {
    const category = await prisma.menuCategory.findFirst({
      where: { tenantId: TENANT_ID, name: group.category },
      select: { id: true },
    }) ?? await prisma.menuCategory.create({
      data: { tenantId: TENANT_ID, name: group.category, sortOrder: index },
      select: { id: true },
    });

    for (const [order, [name, price]] of group.items.entries()) {
      const existing = await prisma.menuItem.findFirst({
        where: { tenantId: TENANT_ID, name },
        select: { id: true, name: true, basePrice: true },
      });
      const item = existing ?? await prisma.menuItem.create({
        data: {
          tenantId: TENANT_ID,
          categoryId: category.id,
          name,
          basePrice: new Prisma.Decimal(price),
          sortOrder: order,
        },
        select: { id: true, name: true, basePrice: true },
      });
      itemsByPrice.push({ id: item.id, name: item.name, price: Number(item.basePrice) });
    }
  }
  console.log(`menu: ${itemsByPrice.length} items across ${MENU.length} categories`);

  // ── Customers ───────────────────────────────────────────────────────────────
  const random = rng(20260803);
  const now = Date.now();
  const DAY = 86_400_000;

  const customerRows = Array.from({ length: CUSTOMER_COUNT }, (_, i) => {
    const waId = `${WA_PREFIX}${String(i + 1).padStart(5, '0')}`;
    const name = `${pick(random, FIRST)} ${pick(random, LAST)}`;
    // Spread over ~120 days, weighted towards recent so `lastSeenAt desc` puts a
    // believable set on the first page rather than an arbitrary one.
    const daysAgo = Math.floor(random() ** 2 * 120);
    return {
      tenantId: TENANT_ID,
      waId,
      name,
      phone: waId,
      lastSeenAt: new Date(now - daysAgo * DAY),
    };
  });

  for (const row of customerRows) {
    await prisma.customer.upsert({
      where: { tenantId_waId: { tenantId: TENANT_ID, waId: row.waId } },
      // Refreshed rather than left alone, so a re-run keeps `lastSeenAt` current and
      // the ordering stays meaningful.
      update: { name: row.name, phone: row.phone, lastSeenAt: row.lastSeenAt },
      create: {
        tenantId: row.tenantId,
        waId: row.waId,
        name: row.name,
        phone: row.phone,
        lastSeenAt: row.lastSeenAt,
      },
    });
  }
  const seeded = await prisma.customer.findMany({
    where: { tenantId: TENANT_ID, waId: { startsWith: WA_PREFIX } },
    select: { id: true, waId: true, name: true, phone: true },
    orderBy: { waId: 'asc' },
  });
  console.log(`customers: ${seeded.length}`);

  // ── Orders ──────────────────────────────────────────────────────────────────
  // Rebuilt rather than added to, so the count is stable across runs. Scoped to
  // customers this script owns, so the workspace's own 9 orders are untouched.
  const removed = await prisma.order.deleteMany({
    where: { customerId: { in: seeded.map((c) => c.id) } },
  });
  if (removed.count) console.log(`cleared ${removed.count} previously seeded orders`);

  const orderRandom = rng(19470815);
  let delivered = 0;

  for (let batchStart = 0; batchStart < ORDER_COUNT; batchStart += 40) {
    const batch = Math.min(40, ORDER_COUNT - batchStart);

    await Promise.all(Array.from({ length: batch }, async (_, offset) => {
      const n = batchStart + offset;
      const customer = seeded[n % seeded.length]!;
      const status = weightedStatus(orderRandom);

      // Dates: the first 30 orders land inside the last 48 hours so Today and
      // Yesterday are never empty, and the rest fan out over 90 days. Without this the
      // date filters look broken on a fresh seed.
      const placedAt = n < 30
        ? new Date(now - Math.floor(orderRandom() * 2 * DAY))
        : new Date(now - Math.floor(1 + orderRandom() ** 1.5 * 90) * DAY);

      const lineCount = 1 + Math.floor(orderRandom() * 4);
      const lines = Array.from({ length: lineCount }, () => {
        const item = pick(orderRandom, itemsByPrice);
        const quantity = 1 + Math.floor(orderRandom() * 3);
        return {
          itemId: item.id,
          itemName: item.name,
          quantity,
          unitPrice: new Prisma.Decimal(item.price),
          lineTotal: new Prisma.Decimal(item.price * quantity),
        };
      });

      // Summed from the lines, never invented separately — a total that disagrees with
      // its own items is worse test data than no data.
      const subtotal = lines.reduce((sum, l) => sum + Number(l.lineTotal), 0);
      if (status === 'DELIVERED') delivered += 1;

      await prisma.order.create({
        data: {
          tenantId: TENANT_ID,
          customerId: customer.id,
          status,
          customerName: customer.name ?? 'Guest',
          contactPhone: customer.phone,
          deliveryAddress: `${1 + Math.floor(orderRandom() * 400)}, ${pick(orderRandom, AREAS)}, Hyderabad`,
          subtotal: new Prisma.Decimal(subtotal),
          totalAmount: new Prisma.Decimal(subtotal),
          placedAt,
          items: { create: lines },
        },
      });
    }));
  }
  console.log(`orders: ${ORDER_COUNT} (${delivered} delivered)`);

  // ── lifetimeSpend ───────────────────────────────────────────────────────────
  // Derived, not decorative: the field is incremented on delivery, and the note on
  // `updateCustomer` is explicit that hand-editing it corrupts revenue analytics. So it
  // is recomputed from the DELIVERED orders actually created rather than made up.
  const spendByCustomer = await prisma.order.groupBy({
    by: ['customerId'],
    where: { tenantId: TENANT_ID, status: 'DELIVERED', customerId: { in: seeded.map((c) => c.id) } },
    _sum: { totalAmount: true },
  });
  for (const row of spendByCustomer) {
    await prisma.customer.update({
      where: { id: row.customerId },
      data: { lifetimeSpend: row._sum.totalAmount ?? new Prisma.Decimal(0) },
    });
  }
  console.log(`lifetimeSpend set for ${spendByCustomer.length} customers`);

  const [totalCustomers, totalOrders] = await Promise.all([
    prisma.customer.count({ where: { tenantId: TENANT_ID } }),
    prisma.order.count({ where: { tenantId: TENANT_ID } }),
  ]);
  console.log(`\nworkspace totals — customers ${totalCustomers}, orders ${totalOrders}`);
};

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
