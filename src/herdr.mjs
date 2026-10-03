import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

export class Herdr {
  constructor(env = process.env) { this.env = env; }
  async call(args) {
    try {
      const { stdout } = await exec(this.env.HERDR_BIN_PATH || 'herdr', args, {
        env: this.env, timeout: 10000, maxBuffer: 4 * 1024 * 1024,
      });
      const response = JSON.parse(stdout);
      if (response.error || !response.result) throw new Error();
      return response.result;
    } catch { throw new Error('target_cli_failed'); }
  }
  async list() {
    const result = await this.call(['agent', 'list']);
    if (!Array.isArray(result.agents)) throw new Error('target_invalid_response');
    return result.agents;
  }
  async rename(paneId, name) { await this.call(['agent', 'rename', paneId, name]); }
}

export function sessionPath(agent) {
  const session = agent?.agent_session;
  if (agent?.agent !== 'pi' || session?.agent !== 'pi' || session.kind !== 'path' ||
      typeof session.value !== 'string' || !session.value.startsWith('/')) {
    throw new Error('target_unsupported_session');
  }
  return session.value;
}

export function invocation(env, action) {
  if (!['check', 'rename', 'pause', 'resume'].includes(action)) throw new Error('request_invalid_action');
  let event = {};
  let context = {};
  try {
    event = JSON.parse(env.HERDR_PLUGIN_EVENT_JSON || '{}');
    context = JSON.parse(env.HERDR_PLUGIN_CONTEXT_JSON || '{}');
  } catch { throw new Error('request_invalid_context'); }
  // Event subject takes precedence over UI focus or inherited caller context.
  const paneId = env.HERDR_PLUGIN_EVENT
    ? event.data?.pane_id ?? event.pane_id
    : context.pane_id ?? context.pane?.pane_id ?? env.HERDR_PANE_ID;
  if (typeof paneId !== 'string' || !paneId) throw new Error('request_missing_pane');
  return { action, paneId };
}
