#!/usr/bin/env tsx
import { prisma } from '../src/config/prisma.js';
import { generateWorkflow } from '../src/modules/conversation-engine/generation/generate.js';

// Ad-hoc generator run, for eyeballing what the model produces.
//   npx tsx scripts/try-generate.ts <tenantId> "description"

const main = async () => {
  const [tenantId, ...rest] = process.argv.slice(2);
  const description = rest.join(' ');
  if (!tenantId || !description) {
    console.error('Usage: npx tsx scripts/try-generate.ts <tenantId> "what it should do"');
    process.exit(1);
  }

  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  const result = await generateWorkflow({ tenant, description });

  console.log(`\n${result.plan.name}  (${result.plan.slug})  · ${result.model} · ${result.latencyMs}ms`);
  console.log(`purpose: ${result.plan.capability.purpose}\n`);
  for (const step of result.plan.steps) {
    const to = [
      step.next ? `→ ${step.next}` : '',
      step.onYes ? `yes → ${step.onYes}` : '',
      step.onNo ? `no → ${step.onNo}` : '',
      step.onError ? `err → ${step.onError}` : '',
    ].filter(Boolean).join('  ');
    console.log(`  ${step.id.padEnd(22)} ${step.kind.padEnd(18)} ${step.title.padEnd(28)} ${to}`);
  }
  console.log(`\nnodes: ${result.compiled.definition.nodes.length}  edges: ${result.compiled.definition.edges.length}`);
  console.log(`gaps (${result.compiled.gaps.length}):`);
  for (const gap of result.compiled.gaps) console.log(`  • ${gap}`);
  const errors = result.issues.filter((i) => i.level === 'error');
  console.log(`validator errors (${errors.length}):`);
  for (const issue of errors) console.log(`  ✗ [${issue.code}] ${issue.message}`);
  const warnings = result.issues.filter((i) => i.level === 'warning');
  console.log(`validator warnings (${warnings.length}):`);
  for (const issue of warnings) console.log(`  ⚠ ${issue.message}`);
};

main().catch((err: Error) => { console.error(err); process.exit(1); }).finally(() => prisma.$disconnect());
