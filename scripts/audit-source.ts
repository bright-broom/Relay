import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';

// Include untracked sources during development and force-added ignored files in CI.
// Build outputs and dependencies stay outside Git through .gitignore.
const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {encoding:'utf8'})
  .split('\0').filter(Boolean);
const javascript = [...new Set(files.filter(file=>/\.(?:js|mjs|cjs|jsx)$/i.test(file)))].sort();
assert.deepEqual(javascript, [], 'JavaScript source reintroduced: migrate to TypeScript or generate it outside Git');
console.log('Source audit: no tracked or untracked JavaScript sources.');
