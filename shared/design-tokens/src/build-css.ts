import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildTokensCss } from './css.ts';

const target = fileURLToPath(new URL('./tokens.css', import.meta.url));
writeFileSync(target, buildTokensCss());
console.log(`Wrote ${target}`);
