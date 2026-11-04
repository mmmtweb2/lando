// Guard: the logo endpoints must stay behind login AND page-ownership checks.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function ok(c: unknown, m: string) { if (!c) { console.error('FAIL:', m); process.exit(1); } }
const src = readFileSync(join(__dirname, '..', 'src/routes/landing.routes.ts'), 'utf-8');

for (const [needle, label] of [
  ["router.post('/:id/update-logo'", 'update-logo'],
  ["router.delete('/:id/logo'", 'delete logo'],
  ["router.delete('/:id/image/:slot'", 'delete image'],
]) {
  const line = src.split('\n').find((l) => l.includes(needle)) ?? '';
  ok(line, `${label} route exists`);
  ok(line.includes('requireAuth') && line.includes('requireOwnPage'), `${label} requires login and page ownership`);
}
const upload = src.split('\n').find((l) => l.includes("/:id/update-logo")) ?? '';
ok(upload.indexOf('requireOwnPage') < upload.indexOf('handleSingleImageUpload'), 'ownership is checked before the upload is read');
console.log('logo route checks passed');
