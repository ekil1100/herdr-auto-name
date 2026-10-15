import test from 'node:test';
import assert from 'node:assert/strict';
import { classify, loadConfig } from '../src/naming.mjs';

// Opt in explicitly: these tests send fixture text to the configured model service.
const directory = process.env.AUTO_NAME_LIVE_CONFIG_DIR;
for (const force of [false, true]) {
  test(`live naming recognizes a bug report with force=${force}`, { skip: !directory }, async () => {
    const config = await loadConfig(directory);
    const result = await classify({
      summary: '', currentName: '', force, recentMessages: [], branchChanged: false,
      newMessages: [{ id: '1', role: 'user', text: 'what next？' }, { id: '2', role: 'user', text: '当前 agent 还是没有命名' }],
    }, config);
    assert.equal(result.decision, 'new_task');
    assert.ok(result.name);
  });
}

test('live naming fills a missing name when the known task continues', { skip: !directory }, async () => {
  const config = await loadConfig(directory);
  const result = await classify({
    summary: '检查 DeepSeek 服务故障是否已修复，并验证自动命名是否恢复',
    currentName: '', force: false, branchChanged: false,
    recentMessages: [{ id: '1', role: 'assistant', text: 'DeepSeek 服务已恢复，自动命名还需要验证。' }],
    newMessages: [
      { id: '2', role: 'user', text: '我试了一下，还是没有rename' },
      { id: '3', role: 'assistant', text: '排查发现模型返回 same_task，插件跳过命名。将为无名称的 agent 设置 force=true，并验证自动改名。' },
    ],
  }, config);
  assert.equal(result.decision, 'new_task');
  assert.ok(result.name);
});

test('live naming keeps vague input unnamed', { skip: !directory }, async () => {
  const config = await loadConfig(directory);
  const result = await classify({
    summary: '', currentName: '', force: true, recentMessages: [], branchChanged: false,
    newMessages: [{ id: '1', role: 'user', text: 'what next？' }],
  }, config);
  assert.equal(result.decision, 'uncertain');
  assert.equal(result.name, '');
});

for (const accepted of [false, true]) {
  test(`live naming respects assistant proposal acceptance=${accepted}`, { skip: !directory }, async () => {
    const config = await loadConfig(directory);
    const result = await classify({
      summary: 'Fix login validation', currentName: 'fix-login', force: false, branchChanged: false,
      recentMessages: [{ id: '1', role: 'user', text: 'Fix login validation' }],
      newMessages: [
        { id: '2', role: 'assistant', text: 'Login validation is fixed. Next we could add retries to the payment client.' },
        ...(accepted ? [{ id: '3', role: 'user', text: 'Yes, do that next.' }] : []),
      ],
    }, config);
    assert.equal(result.decision, accepted ? 'new_task' : 'same_task');
    if (accepted) assert.match(`${result.summary} ${result.name}`, /payment|retr/i);
    else {
      assert.equal(result.name, '');
      assert.match(result.summary, /login/i);
      assert.doesNotMatch(result.summary, /payment/i);
    }
  });
}
