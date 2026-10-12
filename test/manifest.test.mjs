import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('all plugin entry points enable environment proxies', async () => {
  const manifest = await readFile(new URL('../herdr-plugin.toml', import.meta.url), 'utf8');
  const commands = [...manifest.matchAll(/^command\s*=\s*(\[[^\n]*\])/gm)].map((match) => JSON.parse(match[1]));
  assert.equal(commands.length, 5);
  for (const command of commands) {
    assert.deepEqual(command.slice(0, 3), ['node', '--use-env-proxy', 'src/main.mjs']);
  }
});

test('plugin manifest enables macOS and Linux', async () => {
  const manifest = await readFile(new URL('../herdr-plugin.toml', import.meta.url), 'utf8');
  const declaration = manifest.match(/^platforms\s*=\s*(\[[^\n]*\])/m);
  assert.ok(declaration, 'Manifest must declare supported platforms');
  const platforms = JSON.parse(declaration[1]);
  assert.ok(platforms.includes('macos'), 'macOS must be supported');
  assert.ok(platforms.includes('linux'), 'Linux must be supported');
});
