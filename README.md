# Herdr Auto Name

Automatically name local Pi agents in [Herdr](https://herdr.dev) from their current task. Names are short and English: follow-up work keeps the name, while a new goal gets a new name.

| User input | Example result |
| --- | --- |
| “Fix the login failure” | `fix-login` |
| “Continue,” “add tests,” or “commit these changes” | Keep the name |
| “Next, handle payment timeouts” | `fix-payment-timeout` |
| Insufficient context or image-only input | Keep the name |

Actual names depend on the model. You can request a rename, pause automatic naming, or rename an agent yourself. An external manual rename pauses automatic naming for that session.

The plugin supports DeepSeek and OpenAI for task identification and naming, with optional TypeSafe Jev classification to skip naming calls for unchanged tasks. It reads Pi session files without modifying them and requires no changes to Herdr's managed Pi integration.

[Installation](#installation) · [Configuration](#configuration) · [Usage](#usage) · [Troubleshooting](#troubleshooting) · [Limitations](#limitations)

## Installation

### Requirements

| Component | Requirement |
| --- | --- |
| Platform | macOS or Linux; live integration must be verified on your system |
| Node.js | 22.21+ within Node 22, or 24.5+; `node` must be in the plugin process's `PATH` |
| Herdr | 0.9.3 or later; verified with 0.9.3 |
| Agent | Local Pi with a session file path reported by Herdr; parsing uses the v3 JSONL format from Pi 1.0.0 |
| Model service | DeepSeek or OpenAI; TypeSafe is optional |

> **Privacy:** Task text and summaries are sent to the configured model service, and also to TypeSafe when Jev is enabled. Confirm that your sessions may use these services before enabling the plugin. See [Privacy and stored data](#privacy-and-stored-data).

### 1. Link the plugin

From the project root, run in Bash or Zsh:

```bash
npm ci
herdr plugin link "$PWD" --disabled
```

The plugin ID is `local.auto-name`. Keep it disabled until configuration is complete.

### 2. Create the configuration

Find the plugin's configuration directory:

```bash
herdr plugin config-dir local.auto-name
```

Copy [`config.example.json`](config.example.json) into that directory as `config.json`:

```json
{
  "provider": "deepseek",
  "model": "deepseek-flash"
}
```

This uses DeepSeek for both task identification and naming. See [Configuration](#configuration) for OpenAI, Jev, and custom service URLs.

### 3. Set the API key

Make `DEEPSEEK_API_KEY` available in **the environment Herdr uses to start the plugin**. For OpenAI, use `OPENAI_API_KEY` instead.

Set keys through your Herdr launch method or environment management tool. An `export` in an existing pane usually affects only that pane's child processes; the running Herdr service keeps its original environment. Avoid interrupting an active service just to update variables.

The plugin reads keys from environment variables, not Pi's login store. Keep keys out of project files and version control.

### 4. Enable and verify

```bash
herdr plugin enable local.auto-name > /dev/null
```

Paste this prompt into a local Pi agent running in Herdr. The agent can inspect the CLI's JSON output and summarize the result for you:

```text
Verify that the Herdr Auto Name plugin (local.auto-name) works for this Pi agent.

1. Run `herdr plugin list --plugin local.auto-name --json` and confirm that the
   plugin is enabled.
2. Identify this agent and its pane from the current Herdr context. Use
   `herdr agent list` to record its current name and session. If you cannot
   identify the target unambiguously, stop and ask me to select it.
3. Invoke `herdr plugin action invoke local.auto-name.rename` for this pane.
4. Inspect `herdr plugin log list --plugin local.auto-name --limit 20` and
   `herdr agent list`. Allow time for processing and recheck as needed, with
   a bounded wait. Correlate the result with this target and request; an
   accepted action alone does not prove that naming succeeded.
5. Report PASS, FAIL, or INCONCLUSIVE in plain language, with the before/after
   name and relevant evidence. A name that stays the same needs evidence of
   successful processing. If verification fails or remains pending, explain
   the reason and the next step. Do not dump raw JSON.

Do not reveal API keys or full session text, change configuration, restart
Herdr, or rename other agents. This check may rename the current agent to
match this verification task; it verifies manual naming, not automatic events.
```

Enabling alone does not check the current task. Automatic checks run on subsequent agent detection and status changes. The plugin processes eligible local Pi agents throughout that Herdr service, not just the current pane. See [Troubleshooting](#troubleshooting) for common errors.

## Configuration

Settings live in `config.json` in the directory returned by `herdr plugin config-dir local.auto-name`.

### Naming service

| Setting | Supported values or behavior |
| --- | --- |
| `provider` | `deepseek` or `openai` |
| `model` | A model ID offered by the selected service |
| `baseUrl` | Optional service URL override; defaults below |
| `classifier` | Optional Jev configuration; see below |

The naming model must support Chat Completions, `response_format: {"type":"json_object"}`, and `max_tokens`. DeepSeek calls disable thinking mode.

| Provider | Default URL | API key variable |
| --- | --- | --- |
| `deepseek` | `https://api.deepseek.com` | `DEEPSEEK_API_KEY` |
| `openai` | `https://api.openai.com/v1` | `OPENAI_API_KEY` |
| `typesafe` (classifier only) | `https://api.typesafe.ai/v1` | `TYPESAFE_API_KEY` |

For an HTTP forward proxy, set `HTTP_PROXY`, `HTTPS_PROXY`, and optionally `NO_PROXY` in the environment Herdr uses to start the plugin. All plugin entry points enable Node's `--use-env-proxy`, so both naming and Jev requests use these settings. With no proxy configured, requests connect directly. Use `NO_PROXY` to bypass the proxy for selected hosts.

For an API gateway or reverse proxy, set `baseUrl` at the top level or inside `classifier`. The plugin appends `/chat/completions` for naming and `/systemone` for Jev. Keys still come from the selected provider's environment variable.

Remote URLs require HTTPS. HTTP is supported only for `localhost`, `127.0.0.1`, and `::1`.

### Optional Jev classification

Use [`config.jev.example.json`](config.jev.example.json) to classify tasks before calling the naming model:

```json
{
  "provider": "deepseek",
  "model": "deepseek-flash",
  "classifier": {
    "provider": "typesafe",
    "model": "jev-latest"
  }
}
```

This example requires both `DEEPSEEK_API_KEY` and `TYPESAFE_API_KEY`. The supported classifier is `typesafe` / `jev-latest`.

| Condition | Behavior |
| --- | --- |
| `classifier` omitted | One naming-model call identifies the task and generates a name |
| Jev reports the same task or insufficient context | Keep the name and summary; skip the naming-model call |
| Jev reports a new task | Call the naming model for a name and summary |
| Manual rename or resume | Call the naming model directly to allow classification mistakes to be corrected |
| Jev call fails | Keep the name and retry using the selected service |

## Usage

Run actions in the target Pi pane and verify which agent they affect:

| Action | Command |
| --- | --- |
| Rename from the current task | `herdr plugin action invoke local.auto-name.rename` |
| Pause automatic naming | `herdr plugin action invoke local.auto-name.pause` |
| Resume automatic naming | `herdr plugin action invoke local.auto-name.resume` |

A manual rename works while paused and leaves automatic naming paused. Resume accepts the current name as the baseline and checks the task again. Newer control requests supersede older ones.

### Keyboard shortcut

Add this to your Herdr configuration:

```toml
[[keys.command]]
key = "prefix+n"
type = "plugin_action"
command = "local.auto-name.rename"
description = "rename current agent"
```

### Disable or remove

```bash
herdr plugin disable local.auto-name
herdr plugin unlink local.auto-name
```

## Troubleshooting

For diagnostics, inspect the CLI's JSON status and logs:

```bash
herdr plugin list --plugin local.auto-name --json
herdr plugin log list --plugin local.auto-name --limit 20
```

| Symptom or error code | What to check |
| --- | --- |
| Name stays the same after enabling | Enabling does not trigger a check. Request a manual rename and inspect the logs |
| `model_credentials_missing` | Confirm that the plugin process can read the required API key variables |
| `config_missing_or_invalid` | Check for a valid `config.json` in the configuration directory |
| `model_http_401` / `model_http_403` | Check key validity and service access permissions |
| `model_unavailable` | Check the service URL, network, and request timeouts |
| `external_name_paused` / `paused` | Keep the manual name, or run resume to continue automatic naming |
| `target_shared_session` | Multiple panes use the same session; resolve the conflict and retry |
| `session_no_text` | Pending input has no usable text; add a task description |
| `session_size_limit` / `model_input_limit` | The session file or model input exceeds the limits below |
| `unchanged` | This message version has already been processed; no action is needed |

When reporting an issue, include Node.js, Herdr, and Pi versions, reproduction steps, and redacted error codes.

## Limitations

### Platforms and sessions

- The manifest enables macOS and Linux. The plugin uses Node.js and `HERDR_BIN_PATH` to call Herdr, avoiding OS-specific socket transport. Automated tests use mock services; verify live integration on the target system.
- Session paths must be local absolute paths beginning with `/`. Windows drive-letter and backslash UNC paths, remote sessions, and sessions reported only by ID are unsupported.
- Checks run on `pane.agent_detected` and `pane.agent_status_changed`. Messages added without a status change wait for the next event or manual action.
- The parser follows `parentId` on the last persisted branch. An in-memory branch switch becomes visible after a subsequent session write.
- Only complete JSONL lines are read. User text and assistant replies include explicit role labels. Assistant replies provide context; assistant suggestions alone do not establish a new user goal. Thinking blocks, tool calls, tool results, and `custom_message` entries are excluded. Extension messages written through `sendUserMessage()` share the ordinary user-message format and cannot be reliably distinguished.
- Image-only input keeps the name. Mixed input uses only its text.

### Input and request limits

Every model call includes the existing task summary and name, plus at most 3 user and assistant text messages combined. It selects the latest 3 messages; if they omit the latest user message, it selects that user message and the latest 2 other messages instead, in chronological order.

Incremental processing splits this window into recent and new messages at the last processed message. Saved user-only progress remains valid when assistant messages are interleaved; missing or reordered processed IDs indicate a branch change and clear the previous summary. Assistant text updates are checked at the next event or manual action.

| Item | Limit or behavior |
| --- | --- |
| Session file | Read in full on each check, up to 32 MiB |
| Every check or manual rename | At most 3 user and assistant messages combined, retaining the latest user message |
| Model input | 24,000 characters |
| Processing attempts | Up to 3 per operation |
| Model request timeout | 15 seconds per call |
| Herdr CLI timeout | 10 seconds per call |

With Jev enabled, a new task usually requires two sequential model calls.

### Recovery and manual-name protection

Requests within one Herdr service are processed serially. The plugin saves a candidate before renaming, reuses it after a failed rename, and checks the actual name to recover after an interruption.

- There is no persistent polling service. If all processing processes exit, pending requests need a later event or manual action to resume.
- A process that stops after receiving a model response but before saving it may repeat the model call during recovery.
- Herdr 0.9.3 has no atomic rename conditional on the session. Target checks before and after renaming reduce risk, but a race window remains between the check and rename.
- External manual renames pause automatic naming. Name queries cannot detect a manual rename that returns to the original value or matches a pending candidate.

## Privacy and stored data

Model input includes the current task summary, name, necessary recent text, and new text. The plugin redacts configured keys, some common tokens, private keys, and credential assignment patterns. **Redaction is partial:** review the service's data handling scope before sending session text.

| Location | Contents |
| --- | --- |
| Logs | Status, request sequence numbers, and restricted error codes; no full task text, service error responses, or keys |
| `HERDR_PLUGIN_STATE_DIR` | State, pending requests, summaries, message IDs, names, and pending results; no full message text |

Summaries may contain sensitive information. Protect the state directory.

## Development

```bash
npm ci
npm run check
npm test
```

Tests cover task processing, provider configuration, Jev routing, concurrency control, failure recovery, and cross-process integration with mock CLI and HTTP services. They require no real API keys. Classification quality, cost, latency, and Herdr event timing need live verification.

### Processing flow

```text
Event or action → Enqueue → Read session → Identify task → Generate name if needed
  → Recheck target and messages → Rename and confirm → Save progress
```

Opt in to live naming regression tests with a configuration directory and the required API keys in your environment. These tests send fixed fixture messages to the configured services and incur API usage:

```bash
AUTO_NAME_LIVE_CONFIG_DIR=/path/to/config-dir node --use-env-proxy --test test/naming-live.test.mjs
```

| Path | Responsibility |
| --- | --- |
| `herdr-plugin.toml` | Action and event entry points |
| `src/main.mjs` | Enqueueing, serial processing, and bounded retries |
| `src/herdr.mjs` | Herdr CLI and invocation context |
| `src/engine.mjs` | Task state, manual name protection, and recovery |
| `src/pi-session.mjs` | Read-only session parsing |
| `src/naming.mjs` | Provider configuration, model calls, redaction, and name validation |
| `src/state.mjs` | State files, queue, and locks |
| `test/` | Unit and integration tests |

Before submitting changes, run the checks above and add tests for behavior changes.

## References

- [Herdr plugin documentation (0.9.3)](https://raw.githubusercontent.com/herdrdev/herdr/v0.9.3/docs/next/website/src/content/docs/plugins.mdx)
- [DeepSeek API documentation](https://api-docs.deepseek.com/)
- [TypeSafe Choice documentation](https://docs.typesafe.ai/primitives/choice)

## License

[MIT](LICENSE)
