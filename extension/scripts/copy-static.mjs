import { cp, rm } from 'node:fs/promises';

await rm('dist/public', { force: true, recursive: true });
await cp('public', 'dist', { recursive: true });
