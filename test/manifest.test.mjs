import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('plugin manifest enables macOS and Linux', async () => {
  const manifest = await readFile(new URL('../herdr-plugin.toml', import.meta.url), 'utf8');
  const declaration = manifest.match(/^platforms\s*=\s*(\[[^\n]*\])/m);
  assert.ok(declaration, 'Manifest must declare supported platforms');
  const platforms = JSON.parse(declaration[1]);
  assert.ok(platforms.includes('macos'), 'macOS must be supported');
  assert.ok(platforms.includes('linux'), 'Linux must be supported');
});
