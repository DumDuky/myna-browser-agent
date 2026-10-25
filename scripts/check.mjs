import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const files = [];

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) walk(full);
    else if (entry.endsWith('.js') || entry.endsWith('.mjs')) files.push(full);
  }
}

walk(join(root, 'src'));
walk(join(root, 'tests'));
walk(join(root, 'scripts'));

let failed = 0;
for (const file of files) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
    console.log(`ok  ${relative(root, file)}`);
  } catch (error) {
    failed++;
    console.error(`ERR ${relative(root, file)}`);
    console.error(error.stderr?.toString() || error.message);
  }
}

const manifestPath = join(root, 'manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
console.log('manifest: valid JSON');

const referenced = new Set();
for (const value of Object.values(manifest.icons || {})) referenced.add(value);
for (const value of Object.values(manifest.action?.default_icon || {})) {
  referenced.add(value);
}
if (manifest.background?.service_worker) referenced.add(manifest.background.service_worker);
if (manifest.side_panel?.default_path) referenced.add(manifest.side_panel.default_path);
if (manifest.options_page) referenced.add(manifest.options_page);
for (const entry of manifest.content_scripts || []) {
  for (const value of entry.js || []) referenced.add(value);
  for (const value of entry.css || []) referenced.add(value);
}
for (const entry of manifest.web_accessible_resources || []) {
  for (const value of entry.resources || []) referenced.add(value);
}

for (const file of referenced) {
  if (!existsSync(join(root, file))) {
    failed++;
    console.error(`ERR manifest references missing file: ${file}`);
  }
}

if (failed) {
  console.error(`\n${failed} check(s) failed.`);
  process.exit(1);
}
console.log(`\nAll ${files.length} scripts parsed and manifest files exist.`);
