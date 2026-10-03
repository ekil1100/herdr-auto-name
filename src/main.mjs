import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { Herdr, invocation, sessionPath } from './herdr.mjs';
import { Store, safeError } from './state.mjs';
import { readSession } from './pi-session.mjs';
import { classify, loadConfig } from './naming.mjs';
import { processRequest } from './engine.mjs';

export async function main(env = process.env, action = process.argv[2] || 'check') {
  if (!env.HERDR_PLUGIN_STATE_DIR || !env.HERDR_SOCKET_PATH) throw new Error('state_environment_missing');
  const request = invocation(env, action);
  const herdr = new Herdr(env);
  const target = (await herdr.list()).find((a) => a.pane_id === request.paneId);
  // Ignore events for unrelated agent kinds and departed occupants.
  if (!target || target.agent !== 'pi') return;
  request.path = sessionPath(target);
  request.terminalId = target.terminal_id;
  if (typeof request.terminalId !== 'string') throw new Error('target_identity_missing');
  const store = new Store(env.HERDR_PLUGIN_STATE_DIR, env.HERDR_SOCKET_PATH);
  await store.init();
  await store.enqueue(request);
  const lock = await store.lock();
  try {
    const visited = new Set();
    for (let count = 0; count < 128; count++) {
      lock.assert();
      const requests = await store.requests();
      const next = requests.find((r) => !visited.has(r.id));
      if (!next) break;
      visited.add(next.id);
      if (next.action === 'check' && requests.some((r) => r.id > next.id &&
          r.action === 'check' && r.terminalId === next.terminalId && r.path === next.path)) {
        await store.remove(next.id);
        continue;
      }
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const result = await processRequest(next, {
            herdr, store, readSession, assertLock: lock.assert,
            classify: async (input) => classify(input, await loadConfig(env.HERDR_PLUGIN_CONFIG_DIR, env)),
          });
          console.log(JSON.stringify({ status: result, request: next.id }));
          if (result !== 'stale_result') await store.remove(next.id);
          break;
        } catch (error) {
          const code = safeError(error);
          if (code === 'target_changed' || code === 'target_unsupported_session') {
            await store.remove(next.id);
            break;
          }
          if (attempt === 2) console.error(JSON.stringify({ status: 'pending', error: code, request: next.id }));
          else await delay(250 * (attempt + 1));
        }
      }
    }
  } finally { await lock.release(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(JSON.stringify({ status: 'pending', error: safeError(error) }));
    process.exitCode = 1;
  });
}
