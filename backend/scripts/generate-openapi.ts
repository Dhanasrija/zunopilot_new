import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { openapi } from '../src/docs/openapi.js';

// Write `openapi.json` from the spec module.
//
// The JSON is the artifact the mobile team import; `src/docs/openapi.ts` is where it is
// written. Committing the generated file means nobody needs this repo, a toolchain or a
// running server to get the spec — but it also means the two can disagree, so
// `openapi.drift.test.ts` regenerates in memory and fails if they have.
//
//   npm run openapi

const target = resolve(import.meta.dirname, '../openapi.json');
writeFileSync(target, `${JSON.stringify(openapi, null, 2)}\n`);
console.log(`Wrote ${target}`);
