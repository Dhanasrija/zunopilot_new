import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { prisma } from '../src/config/prisma.js';

// Seed the first super admin.
//
// Idempotent: re-running updates the name and reactivates the account but leaves
// an existing password alone, so it is safe to run on every deploy. Rotating the
// password is deliberate and explicit — pass --reset.
//
//   npx tsx prisma/seed-superadmin.ts
//   npx tsx prisma/seed-superadmin.ts --reset
//   SUPERADMIN_EMAIL=me@x.com SUPERADMIN_PASSWORD='...' npx tsx prisma/seed-superadmin.ts

const EMAIL = (process.env.SUPERADMIN_EMAIL || 'superadmin@zunopilot.com').toLowerCase();
const NAME = process.env.SUPERADMIN_NAME || 'ZunoPilot Super Admin';
const RESET = process.argv.includes('--reset');

/** A supplied password is used as-is; otherwise one is generated and printed once. */
const resolvePassword = (): { password: string; generated: boolean } => {
  const supplied = process.env.SUPERADMIN_PASSWORD;
  if (supplied) return { password: supplied, generated: false };
  // Printed once and never recoverable, the same contract as a team invite.
  return { password: `Zp-${randomBytes(12).toString('base64url')}`, generated: true };
};

const main = async () => {
  const existing = await prisma.superAdmin.findUnique({ where: { email: EMAIL } });

  if (existing && !RESET) {
    await prisma.superAdmin.update({
      where: { id: existing.id },
      data: { fullName: NAME, isActive: true },
    });
    console.log(`\nSuper admin already exists — password left unchanged.\n`);
    console.log(`  email   ${EMAIL}`);
    console.log(`  name    ${NAME}`);
    console.log(`  active  yes`);
    console.log(`\nTo set a new password:  npx tsx prisma/seed-superadmin.ts --reset\n`);
    return;
  }

  const { password, generated } = resolvePassword();
  const passwordHash = await bcrypt.hash(password, 10);

  const admin = await prisma.superAdmin.upsert({
    where: { email: EMAIL },
    create: { email: EMAIL, fullName: NAME, passwordHash, isActive: true },
    update: { fullName: NAME, passwordHash, isActive: true },
  });

  // Recorded so a password rotation is visible in the audit log rather than
  // being the one privileged action nothing witnesses.
  await prisma.auditEvent.create({
    data: {
      superAdminId: admin.id,
      action: existing ? 'superadmin.password_reset' : 'superadmin.created',
      summary: existing
        ? `Password reset for ${EMAIL} by seed script`
        : `Super admin ${EMAIL} created by seed script`,
    },
  });

  console.log(`\n${existing ? 'Super admin password reset.' : 'Super admin created.'}\n`);
  console.log(`  email     ${EMAIL}`);
  console.log(`  password  ${password}`);
  console.log(`  console   http://localhost:5174`);
  if (generated) {
    console.log('\nThis password is shown once and is not recoverable. Save it now.');
  }
  console.log('\nThe API also needs a signing secret in backend/.env:');
  console.log('  SUPERADMIN_JWT_SECRET=$(openssl rand -base64 48)\n');
};

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
