import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';

const audit = resolve('scripts/audit-source.ts');
const fixture = await mkdtemp(join(tmpdir(),'relay-source-audit-'));
const check = () => spawnSync(process.execPath,[audit],{cwd:fixture,encoding:'utf8'});
try {
  execFileSync('git',['init','--quiet'],{cwd:fixture});
  await writeFile(join(fixture,'.gitignore'),'prototype/\nnode_modules/\n');
  await writeFile(join(fixture,'entry.ts'),'export const example: number = 1;\n');
  for (const directory of ['prototype','node_modules']) {
    await mkdir(join(fixture,directory));
    await writeFile(join(fixture,directory,'generated.js'),'export const example = 1;\n');
  }
  assert.equal(check().status,0,'Ignored generated files and dependencies are not source code');
  for (const extension of ['js','mjs','cjs','jsx']) {
    const file = `legacy.${extension}`;
    await writeFile(join(fixture,file),'');
    const result = check();
    assert.equal(result.status,1,`Untracked ${extension} must fail`);
    assert.ok(result.stderr.includes(file));
    await rm(join(fixture,file));
  }
  execFileSync('git',['add','--force','prototype/generated.js'],{cwd:fixture});
  const forced = check();
  assert.equal(forced.status,1,'Force-adding an ignored generated file must still fail');
  assert.ok(forced.stderr.includes('prototype/generated.js'));
  console.log('Source audit controls: TypeScript, ignored builds/dependencies, four JavaScript extensions and force-added outputs verified.');
} finally {await rm(fixture,{recursive:true,force:true});}
