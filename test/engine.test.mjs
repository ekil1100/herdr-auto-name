import test from 'node:test';
import assert from 'node:assert/strict';
import { processRequest } from '../src/engine.mjs';

function fixture() {
  const f = {
    agents: [{ agent: 'pi', terminal_id: 't1', pane_id: 'w1:p1', agent_session: { agent: 'pi', kind: 'path', value: '/session' } }],
    snapshot: { sessionId: 's1', fileIdentity: '1:1', version: 'v1', messages: [{ id: 'u1', text: 'Fix login' }] },
    saved: null, calls: 0, renames: 0, control: false,
    decision: { decision: 'new_task', summary: 'Fix login', name: 'fix-login' },
    request: { id: 'request', action: 'check', terminalId: 't1', path: '/session' },
  };
  f.deps = {
    herdr: {
      list: async () => structuredClone(f.agents),
      rename: async (paneId, name) => { f.renames++; f.agents.find((a) => a.pane_id === paneId).name = name; },
    },
    readSession: async () => structuredClone(f.snapshot),
    store: {
      load: async () => structuredClone(f.saved),
      save: async (_, value) => { f.saved = structuredClone(value); },
      hasControl: async () => f.control,
    },
    classify: async (input) => { f.calls++; f.input = input; return f.decision; },
  };
  f.run = (action = 'check') => processRequest({ ...f.request, action }, f.deps);
  f.add = (text = 'Continue') => {
    const id = `u${f.snapshot.messages.length + 1}`;
    f.snapshot.messages.push({ id, text }); f.snapshot.version = id;
  };
  return f;
}

test('first task renames, duplicate checks do not call the model, continuation keeps name', async () => {
  const f = fixture();
  assert.equal(await f.run(), 'renamed');
  assert.equal(await f.run(), 'unchanged');
  assert.equal(f.calls, 1);
  f.add('Add tests and commit');
  f.decision = { decision: 'same_task', summary: 'Fix login with tests', name: 'fix-login' };
  assert.equal(await f.run(), 'same_task');
  assert.equal(f.renames, 1);
  f.add('Now fix payment timeout');
  f.decision = { decision: 'new_task', summary: 'Fix payment timeout', name: 'fix-payment' };
  assert.equal(await f.run(), 'renamed');
  assert.equal(f.agents[0].name, 'fix-payment');
});

test('uncertain and image-only messages preserve the name', async () => {
  const f = fixture();
  f.decision = { decision: 'uncertain', summary: '', name: '' };
  assert.equal(await f.run(), 'uncertain');
  assert.equal(f.renames, 0);
  f.add('');
  assert.equal(await f.run(), 'no_text');
  assert.equal(f.calls, 1);
});

test('pause, explicit one-off rename, and resume have distinct semantics', async () => {
  const f = fixture();
  assert.equal(await f.run('pause'), 'paused');
  assert.equal(await f.run(), 'paused');
  assert.equal(f.calls, 0);
  assert.equal(await f.run('rename'), 'renamed');
  assert.equal(f.saved.paused, true);
  assert.equal(await f.run('resume'), 'renamed');
  assert.equal(f.saved.paused, false);
});

test('external names pause automation, including edits during the model call', async () => {
  const f = fixture();
  await f.run();
  f.agents[0].name = 'manual';
  assert.equal(await f.run(), 'external_name_paused');
  f.add();
  assert.equal(await f.run(), 'paused');
  const g = fixture();
  g.deps.classify = async () => { g.agents[0].name = 'manual'; return g.decision; };
  assert.equal(await g.run(), 'external_name_paused');
  assert.equal(g.renames, 0);
});

test('model-time message changes and queued controls discard stale results', async () => {
  const f = fixture();
  f.deps.classify = async () => { f.add('New goal'); return f.decision; };
  assert.equal(await f.run(), 'stale_result');
  assert.equal(f.renames, 0);
  const g = fixture(); g.control = true;
  assert.equal(await g.run(), 'superseded');
  assert.equal(g.renames, 0);
});

test('session switches reject old results and shared session panes are refused', async () => {
  const f = fixture();
  f.deps.classify = async () => { f.agents[0].agent_session.value = '/other'; return f.decision; };
  await assert.rejects(f.run(), /target_changed/);
  assert.equal(f.renames, 0);
  const g = fixture();
  g.agents.push({ ...structuredClone(g.agents[0]), pane_id: 'w2:p2', terminal_id: 't2' });
  await assert.rejects(g.run(), /shared_session/);
});

test('pane moves follow terminal identity', async () => {
  const f = fixture();
  f.deps.classify = async () => { f.agents[0].pane_id = 'w2:p4'; return f.decision; };
  assert.equal(await f.run(), 'renamed');
});

test('rename failure retains generated result and retries without another model call', async () => {
  const f = fixture();
  const rename = f.deps.herdr.rename;
  f.deps.herdr.rename = async () => { throw new Error('target_cli_failed'); };
  await assert.rejects(f.run(), /cli_failed/);
  assert.equal(f.saved.pending.name, 'fix-login');
  f.deps.herdr.rename = rename;
  assert.equal(await f.run(), 'renamed');
  assert.equal(f.calls, 1);
});

test('rename applied but response lost recovers by reading actual name', async () => {
  const f = fixture();
  f.deps.herdr.rename = async (_, name) => { f.agents[0].name = name; throw new Error('target_cli_failed'); };
  await assert.rejects(f.run(), /cli_failed/);
  assert.equal(await f.run(), 'unchanged');
  assert.equal(f.saved.paused, false);
  assert.equal(f.saved.pending, null);
  assert.equal(f.calls, 1);
});

test('persisted branch changes exclude previous task summary', async () => {
  const f = fixture();
  await f.run();
  f.snapshot.messages = [{ id: 'different', text: 'Fix database' }]; f.snapshot.version = 'branch2';
  await f.run();
  assert.equal(f.input.summary, '');
  assert.equal(f.input.branchChanged, true);
});

test('image-only branch clears the previous summary before later text input', async () => {
  const f = fixture();
  await f.run();
  f.snapshot.messages = [{ id: 'image-branch', text: '' }];
  f.snapshot.version = 'image-branch';
  assert.equal(await f.run(), 'no_text');
  assert.equal(f.saved.summary, '');
  assert.equal(f.agents[0].name, 'fix-login');
  f.add('Describe this image');
  await f.run();
  assert.equal(f.input.summary, '');
});

test('image-only continuation preserves the existing task summary', async () => {
  const f = fixture();
  await f.run();
  f.add('');
  assert.equal(await f.run(), 'no_text');
  assert.equal(f.saved.summary, 'Fix login');
});

test('model errors preserve progress and old name', async () => {
  const f = fixture();
  f.deps.classify = async () => { throw new Error('model_unavailable'); };
  await assert.rejects(f.run(), /model_unavailable/);
  assert.equal(f.saved.version, null);
  assert.equal(f.saved.error, 'model_unavailable');
  assert.equal(f.renames, 0);
});

test('name collisions get a bounded suffix', async () => {
  const f = fixture();
  f.agents.push({ agent: 'codex', terminal_id: 't2', pane_id: 'w1:p2', name: 'fix-login' });
  await f.run();
  assert.match(f.agents[0].name, /^fix-login-[0-9a-f]{4}$/);
});

test('manual rename retries and completed queue replay reuse the saved decision', async () => {
  const f = fixture();
  const rename = f.deps.herdr.rename;
  f.deps.herdr.rename = async () => { throw new Error('target_cli_failed'); };
  await assert.rejects(f.run('rename'), /cli_failed/);
  f.deps.herdr.rename = rename;
  assert.equal(await f.run('rename'), 'renamed');
  assert.equal(await f.run('rename'), 'unchanged');
  assert.equal(f.calls, 1);
  assert.equal(f.renames, 1);
});

test('restored terminal identity is saved before unchanged return, protecting later manual edits', async () => {
  const f = fixture();
  await f.run();
  f.agents[0].terminal_id = 't2'; f.request.terminalId = 't2';
  delete f.agents[0].name;
  assert.equal(await f.run(), 'unchanged');
  assert.equal(f.saved.terminalId, 't2');
  f.agents[0].name = 'manual'; f.add();
  assert.equal(await f.run(), 'external_name_paused');
  assert.equal(f.renames, 1);
});

test('newer pause supersedes an in-flight manual rename and does not regenerate on recovery', async () => {
  const f = fixture();
  f.deps.classify = async () => { f.control = true; f.calls++; return f.decision; };
  assert.equal(await f.run('rename'), 'superseded');
  f.control = false;
  await f.run('pause');
  assert.equal(await f.run(), 'paused');
  assert.equal(f.renames, 0);
  assert.equal(f.calls, 1);
});

test('failed old manual request cannot cross a newer completed pause', async () => {
  const f = fixture();
  f.request.id = '001';
  f.deps.classify = async () => { throw new Error('model_unavailable'); };
  await assert.rejects(f.run('rename'), /model_unavailable/);
  f.request.id = '002';
  assert.equal(await f.run('pause'), 'paused');
  f.request.id = '001';
  assert.equal(await f.run('rename'), 'superseded');
  assert.equal(f.saved.paused, true);
  assert.equal(f.renames, 0);
});
