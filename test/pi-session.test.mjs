import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseSession, readSession } from '../src/pi-session.mjs';

const header = { type: 'session', version: 3, id: 'session' };
const user = (id, parentId, content) => ({ type: 'message', id, parentId, message: { role: 'user', content } });
const jsonl = (...entries) => [header, ...entries].map(JSON.stringify).join('\n') + '\n';

test('reads persisted branch, excluding assistant and extension custom messages', () => {
  const snapshot = parseSession(jsonl(
    user('a', null, 'Fix login'),
    user('b', 'a', 'Unrelated branch'),
    { type: 'custom_message', id: 'c', parentId: 'a', content: 'Injected custom message' },
    { type: 'message', id: 'd', parentId: 'c', message: { role: 'assistant', content: 'Response' } },
    user('e', 'd', [{ type: 'image', data: 'secret' }, { type: 'text', text: 'Add tests' }]),
  ));
  assert.deepEqual(snapshot.messages, [{ id: 'a', text: 'Fix login' }, { id: 'e', text: 'Add tests' }]);
  assert.equal(snapshot.activeLeaf, 'unknown');
});

test('ignores incomplete trailing records and handles image-only input', () => {
  const snapshot = parseSession(jsonl(user('a', null, [{ type: 'image', data: 'blob' }])) + '{"type":');
  assert.equal(snapshot.partial, true);
  assert.equal(snapshot.messages[0].text, '');
});

test('rejects unsupported versions, malformed complete rows, duplicates and broken links', () => {
  assert.throws(() => parseSession('{"type":"session","version":2,"id":"x"}\n'), /unsupported/);
  assert.throws(() => parseSession(jsonl() + 'bad\n'), /invalid_json/);
  assert.throws(() => parseSession(jsonl(user('a', 'missing', 'task'))), /invalid_tree/);
  assert.throws(() => parseSession(jsonl(user('a', null, 'task'), user('a', 'a', 'other'))), /invalid_tree/);
});

test('assistant appends do not change task version', () => {
  const text = jsonl(user('a', null, 'Task'));
  const appended = text + JSON.stringify({ type: 'usage', id: 'b', parentId: 'a' }) + '\n';
  assert.equal(parseSession(text).version, parseSession(appended).version);
});

test('file replacement and truncation are reread, without modifying session', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'auto-name-session-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'session.jsonl');
  await writeFile(path, jsonl(user('a', null, 'Task')));
  const before = await readSession(path);
  await writeFile(join(dir, 'replacement'), jsonl(user('z', null, 'New task')));
  await rename(join(dir, 'replacement'), path);
  const after = await readSession(path);
  assert.notEqual(after.fileIdentity, before.fileIdentity);
  assert.deepEqual(after.messages, [{ id: 'z', text: 'New task' }]);
  await writeFile(path, jsonl());
  assert.deepEqual((await readSession(path)).messages, []);
});
