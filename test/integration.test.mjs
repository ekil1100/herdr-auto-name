import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { Store } from '../src/state.mjs';

const exec = promisify(execFile);

test('CLI + HTTP + disk integration: duplicates, process restart, pause during model call, resume', { timeout: 20000 }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'auto-name-integration-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const config = join(root, 'config'); const state = join(root, 'state');
  await mkdir(config);
  const session = join(root, 'session.jsonl');
  const records = [{ type: 'session', version: 3, id: 'session' },
    { type: 'message', id: 'u1', parentId: null, message: { role: 'user', content: 'Fix login' } }];
  const persist = () => writeFile(session, records.map(JSON.stringify).join('\n') + '\n');
  await persist();
  const agentFile = join(root, 'agents.json');
  await writeFile(agentFile, JSON.stringify([{ agent: 'pi', terminal_id: 'terminal', pane_id: 'w1:p1',
    agent_session: { agent: 'pi', kind: 'path', value: session } }]));
  const fake = resolve('test/fixtures/fake-herdr.mjs'); await chmod(fake, 0o755);
  let calls = 0; let gate; let started;
  const server = createServer(async (req, res) => {
    calls++;
    let body = ''; for await (const chunk of req) body += chunk;
    assert.equal(req.url, '/v1/chat/completions');
    assert.equal(req.headers.authorization, 'Bearer test-key');
    assert.equal(JSON.parse(body).model, 'test');
    if (started) started();
    if (gate) await gate;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ decision: 'new_task', summary: 'Fix login', name: 'fix-login' }) } }] }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  await writeFile(join(config, 'config.json'), JSON.stringify({ provider: 'deepseek', baseUrl: `http://127.0.0.1:${server.address().port}/v1`, model: 'test' }));
  const env = { ...process.env, HERDR_BIN_PATH: fake, HERDR_SOCKET_PATH: join(root, 'socket'),
    HERDR_PLUGIN_STATE_DIR: state, HERDR_PLUGIN_CONFIG_DIR: config, HERDR_PANE_ID: 'w1:p1',
    HERDR_PLUGIN_CONTEXT_JSON: '{}', HERDR_PLUGIN_EVENT: '', HERDR_PLUGIN_EVENT_JSON: '{}',
    TEST_HERDR_STATE: agentFile, DEEPSEEK_API_KEY: 'test-key' };
  const run = (action = 'check') => exec(process.execPath, ['src/main.mjs', action], { env, timeout: 18000 });
  await Promise.all([run(), run()]);
  assert.equal(calls, 1);
  assert.equal(JSON.parse(await readFile(agentFile, 'utf8'))[0].name, 'fix-login');
  await run(); assert.equal(calls, 1);

  records.push({ type: 'message', id: 'u2', parentId: 'u1', message: { role: 'user', content: 'Fix payment instead' } });
  await persist();
  let release;
  gate = new Promise((resolve) => { release = resolve; });
  const modelStarted = new Promise((resolve) => { started = resolve; });
  const working = run();
  await modelStarted;
  const pausing = run('pause');
  const store = new Store(state, env.HERDR_SOCKET_PATH);
  for (let i = 0; i < 100 && (await store.requests()).length < 2; i++) await delay(20);
  assert.equal((await store.requests()).length, 2);
  release();
  await Promise.all([working, pausing]);
  const saved = await store.load(JSON.stringify(['pi', session, 'session']));
  assert.equal(saved.paused, true);
  assert.equal(saved.version === null, false);
  assert.equal((await store.requests()).length, 0);
  await run(); assert.equal(calls, 2);
  gate = null; started = null;
  await run('resume'); assert.equal(calls, 3);
  assert.equal((await store.load(JSON.stringify(['pi', session, 'session']))).paused, false);
});
