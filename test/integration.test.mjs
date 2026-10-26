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

for (const agentKind of ['pi', 'claude', 'codex', 'kimi']) {
test(`${agentKind} CLI + HTTP + disk integration: duplicates, process restart, pause during model call, resume`, { timeout: 20000 }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'auto-name-integration-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const config = join(root, 'config'); const state = join(root, 'state');
  await mkdir(config);
  const session = join(root, {
    pi: 'session.jsonl', claude: '.claude/projects/project/session.jsonl',
    codex: '.codex/sessions/2026/01/01/rollout-date-session.jsonl',
    kimi: '.kimi/sessions/project/session/context.jsonl',
  }[agentKind]);
  await mkdir(join(session, '..'), { recursive: true });
  const records = [{ type: 'session', version: 3, id: 'session' },
    { type: 'message', id: 'u1', parentId: null, message: { role: 'user', content: 'Fix login' } }];
  const persist = () => {
    const messages = records.slice(1);
    const transcript = {
      pi: records,
      claude: messages.map((r) => ({ type: 'user', uuid: r.id, parentUuid: r.parentId, sessionId: 'session', message: r.message })),
      codex: [{ type: 'session_meta', payload: { id: 'session' } }, ...messages.map((r) => ({
        type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: r.message.content }] },
      }))],
      kimi: messages.map((r) => r.message),
    }[agentKind];
    return writeFile(session, transcript.map(JSON.stringify).join('\n') + '\n');
  };
  await persist();
  const agentFile = join(root, 'agents.json');
  const sessionValue = agentKind === 'pi' ? session : 'session';
  await writeFile(agentFile, JSON.stringify([{ agent: agentKind, terminal_id: 'terminal', pane_id: 'w1:p1',
    agent_session: { agent: agentKind, kind: agentKind === 'pi' ? 'path' : 'id', value: sessionValue } }]));
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
  const env = { ...process.env, HOME: root, CLAUDE_CONFIG_DIR: join(root, '.claude'), CODEX_HOME: join(root, '.codex'), KIMI_SHARE_DIR: join(root, '.kimi'), HERDR_BIN_PATH: fake, HERDR_SOCKET_PATH: join(root, 'socket'),
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
  const saved = await store.load(JSON.stringify([agentKind, sessionValue, 'session']));
  assert.equal(saved.paused, true);
  assert.equal(saved.version === null, false);
  assert.equal((await store.requests()).length, 0);
  await run(); assert.equal(calls, 2);
  gate = null; started = null;
  await run('resume'); assert.equal(calls, 3);
  assert.equal((await store.load(JSON.stringify([agentKind, sessionValue, 'session']))).paused, false);
});
}
