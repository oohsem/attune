// Run: node scripts/verify-audio-dataset.mjs
// Requires only Node.js (no extra npm packages).
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/audio-dataset');
if (!existsSync(root)) {
  console.error(`Missing: ${root}`);
  console.error('Extract audio-dataset.zip into your project public/ folder.');
  process.exit(1);
}
const collections = readdirSync(root, { withFileTypes: true }).filter(e => e.isDirectory());
let total = 0;
let failed = false;
for (const group of collections) {
  const dir = path.join(root, group.name, 'mp3');
  if (!existsSync(dir)) { console.error(`Missing mp3/: ${group.name}`); failed = true; continue; }
  const count = readdirSync(dir).filter(file => file.toLowerCase().endsWith('.mp3')).length;
  total += count;
  console.log(`${group.name}: ${count} MP3 files`);
  if (count !== 20) failed = true;
}
console.log(`\nFound ${collections.length} collections / ${total} MP3 files.`);
if (collections.length !== 20 || total !== 400 || failed) {
  console.error('Dataset does not match the uploaded 20-collection / 400-file ZIP.');
  process.exitCode = 1;
} else {
  console.log('Dataset is in the expected location!');
}
