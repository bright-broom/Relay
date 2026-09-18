import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFile, readdir} from 'node:fs/promises';
import {join} from 'node:path';

async function snapshot() {
  const hashes: Record<string,string> = {};
  for (const directory of ['prototype','public','dist/server']) {
    const entries = await readdir(directory,{recursive:true,withFileTypes:true});
    for (const entry of entries.filter(item=>item.isFile())) {
      const path = join(entry.parentPath,entry.name);
      hashes[path] = createHash('sha256').update(await readFile(path)).digest('hex');
    }
  }
  return hashes;
}
// Run after `npm run check`. The build clears its output directories so stale
// files cannot make a missing generation step appear reproducible.
const before = await snapshot();
execFileSync(process.execPath,['scripts/build.ts'],{stdio:'inherit'});
assert.deepEqual(await snapshot(),before,'Build output paths or contents changed on regeneration');
console.log(`Reproducible build: ${Object.keys(before).length} generated files match exactly.`);
