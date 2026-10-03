# Herdr Auto Name

Automatically give Pi agents in [Herdr](https://herdr.dev) short English names based on their current task. Names stay the same for follow-up work and change when the main goal changes.

| User input | Expected behavior |
| --- | --- |
| “Fix the login failure” | Set the name to `fix-login` |
| “Continue,” “add tests,” or “commit these changes” | Keep the name |
| “Next, handle payment timeouts” | Change the name to `fix-payment-timeout` |
| Insufficient context or image-only input | Keep the name |

A model identifies the task, so actual names may differ from these examples. If it makes a mistake, you can rename the agent manually or pause automatic naming.

## Features

- Listen for Herdr agent detection and status changes to check for new tasks.
- Use DeepSeek or OpenAI to identify tasks and generate names.
- Optionally classify tasks with TypeSafe Jev first, calling the naming model only when a new name is needed.
- Save progress, skip processed messages, and retry failed operations.
- Detect external manual renames and pause automatic naming for that session.
- Provide rename, pause, and resume actions that can be bound to keyboard shortcuts.

## Requirements

| Component | Requirement |
| --- | --- |
| Plugin platform declaration | Currently macOS only; see [Platform compatibility](#platform-compatibility) |
| Node.js | 22 or later; `node` must be in the Herdr plugin process's `PATH` |
| Herdr | 0.9.3 or later; verified with 0.9.3 |
| Agent | Local Pi; session parsing uses the v3 JSONL format from Pi 1.0.0 |
| Model service | DeepSeek or OpenAI; Jev classification is optional |

Herdr must report the path to Pi's local session file. The plugin reads that file without modifying it and uses a separate Herdr plugin entry point. No changes to Herdr's managed Pi integration are required.

### Platform compatibility

Herdr's plugin system supports Linux, macOS, and Windows. This project's manifest currently declares only `platforms = ["macos"]`; that is a plugin-specific restriction, not a macOS requirement imposed by Herdr.

The plugin uses Node.js and calls Herdr through `HERDR_BIN_PATH`, avoiding OS-specific socket transport. However, its session-path validation currently requires a leading `/`, which rejects Windows drive-letter and backslash UNC paths. Linux and Windows compatibility has not been verified. Cross-platform support requires updating the manifest, correcting path validation where needed, and testing on the target systems.

## Quick start

> **Privacy notice:** The plugin sends necessary task text and summaries to the configured model service. Before enabling it, confirm that the relevant sessions may use these services. When Jev is enabled, task text is also sent to TypeSafe.

### 1. Install dependencies and link the plugin

After downloading the project, run these commands from the project root in Bash or Zsh:

```bash
npm ci
herdr plugin link "$PWD" --disabled
```

Link the plugin in a disabled state, then enable it after configuration. The plugin ID is `local.auto-name`.

### 2. Create the configuration

Find the configuration directory:

```bash
herdr plugin config-dir local.auto-name
```

Copy [`config.example.json`](config.example.json) to that directory as `config.json`:

```json
{
  "provider": "deepseek",
  "model": "deepseek-flash"
}
```

This configuration uses DeepSeek for task identification and naming. The provider determines the default service URL and API key environment variable.

### 3. Set API keys

| Provider | API key environment variable | Purpose |
| --- | --- | --- |
| `deepseek` | `DEEPSEEK_API_KEY` | Task identification and naming |
| `openai` | `OPENAI_API_KEY` | Task identification and naming |
| `typesafe` | `TYPESAFE_API_KEY` | Optional Jev classification |

Keys must be available in **the environment Herdr uses to start the plugin**. Set them through your Herdr launch method or environment management tool.

Running `export` in an existing pane usually affects only that pane's child processes. The running Herdr service keeps its original environment. Check the plugin logs to verify access. Avoid interrupting an active Herdr service just to update environment variables.

The plugin reads keys from environment variables, not Pi's login store. Keep keys out of project files and version control.

### 4. Enable and verify

```bash
herdr plugin enable local.auto-name
herdr plugin list --plugin local.auto-name --json
```

Confirm that the output includes `"enabled": true`. Subsequent agent detection and status change events trigger checks; enabling the plugin does not immediately check the current task.

Run a manual rename in the target Pi pane, then inspect the logs and agent name:

```bash
herdr plugin action invoke local.auto-name.rename
herdr plugin log list --plugin local.auto-name --limit 20
herdr agent list
```

Once enabled, the plugin processes eligible local Pi agents in that Herdr service. Verify this scope rather than checking only the current pane.

## Configuration

### Optional: Jev classification with a separate naming model

Use [`config.jev.example.json`](config.jev.example.json):

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

This configuration requires both `DEEPSEEK_API_KEY` and `TYPESAFE_API_KEY`.

| Condition | Behavior |
| --- | --- |
| `classifier` is omitted | The naming model identifies the task and generates a name in one call |
| Jev identifies the same task or insufficient context | Keep the name and existing summary; skip the naming model call |
| Jev identifies a new task | The naming model generates a name and summary |
| Manual rename or resume | Call the naming model directly to allow classification mistakes to be corrected |
| A configured Jev call fails | Keep the name and retry using the selected service |

Jev uses TypeSafe's `/systemone` endpoint. The supported classifier is currently the `jev-latest` model from the `typesafe` provider.

### Naming models and custom URLs

The top-level `provider` supports `deepseek` and `openai`. Set `model` to a model ID offered by that service. The naming model must support Chat Completions, `response_format: {"type":"json_object"}`, and `max_tokens`. DeepSeek calls disable thinking mode.

Default URLs:

| Provider | URL |
| --- | --- |
| `deepseek` | `https://api.deepseek.com` |
| `openai` | `https://api.openai.com/v1` |
| `typesafe` | `https://api.typesafe.ai/v1` |

To use a proxy, add `baseUrl` to the top-level configuration or the `classifier` object. The code appends `/chat/completions` or `/systemone`, respectively. Keys are still read from the corresponding provider's environment variable.

Remote URLs require HTTPS. HTTP is supported only for `localhost`, `127.0.0.1`, and `::1`.

## Everyday use

Run these commands in the target Pi pane and verify which agent they affect:

| Action | Command |
| --- | --- |
| Rename | `herdr plugin action invoke local.auto-name.rename` |
| Pause automatic naming | `herdr plugin action invoke local.auto-name.pause` |
| Resume automatic naming | `herdr plugin action invoke local.auto-name.resume` |

While paused, you can still request a single manual rename; automatic naming remains paused afterward. Resuming accepts the current name as the new baseline and checks the task again. Newer control requests supersede older ones.

Add a keyboard shortcut to your Herdr configuration:

```toml
[[keys.command]]
key = "prefix+n"
type = "plugin_action"
command = "local.auto-name.rename"
description = "rename current agent"
```

Disable or unlink the plugin:

```bash
herdr plugin disable local.auto-name
herdr plugin unlink local.auto-name
```

## Troubleshooting

Start by checking the plugin status and logs:

```bash
herdr plugin list --plugin local.auto-name --json
herdr plugin log list --plugin local.auto-name --limit 20
```

| Symptom or error code | What to check |
| --- | --- |
| Name stays the same after enabling | Enabling does not trigger an immediate check. Run a manual rename and inspect the logs |
| `model_credentials_missing` | Check whether the Herdr plugin process can read the required API key variables |
| `config_missing_or_invalid` | Check for a valid `config.json` in the configuration directory |
| `model_http_401` / `model_http_403` | Check key validity and service access permissions |
| `model_unavailable` | Check the service URL, network, and request timeouts |
| `external_name_paused` / `paused` | Decide whether to keep the manual name; run resume to continue automatic naming |
| `target_shared_session` | Multiple panes use the same session; resolve the conflict and retry |
| `session_no_text` | Pending input has no usable text; add a text description of the task |
| `session_size_limit` / `model_input_limit` | The session file or model input exceeds the current limit |
| `unchanged` | The current message version has already been processed and needs no additional rename |

## How it works and limitations

The plugin reads user messages on the last persisted branch and processes them as follows:

```text
Event or manual action → Enqueue request → Read session → Identify task
  → Generate name if needed → Recheck target and messages → Rename and confirm → Save progress
```

### Triggers and session scope

- Listens for `pane.agent_detected` and `pane.agent_status_changed`. Messages added during work without a status change wait for the next event or manual action.
- Supports local absolute paths beginning with `/` and v3 JSONL session files. Windows drive-letter and backslash UNC paths, remote sessions, and sessions reported only by ID are currently unsupported.
- Follows `parentId` to read the last persisted branch. If Pi switches branches only in memory, the plugin observes the change after a subsequent write.
- Excludes assistant, tool, and `custom_message` entries. Messages written by extensions through `sendUserMessage()` have the same format as ordinary user messages, so their source cannot be reliably distinguished.
- Reads only complete JSONL lines. Image-only input keeps the current name; mixed input uses only the text.
- Reads the whole file on each check, up to 32 MiB. Initial processing, branch changes, and manual renames use the latest 8 user messages. Regular incremental processing uses all new messages plus up to 4 recent messages. Model input is limited to 24,000 characters.

### Failure recovery

- Requests within the same Herdr service are processed serially. State and pending requests are stored in `HERDR_PLUGIN_STATE_DIR`.
- Saves a candidate name before renaming. Failed renames reuse the candidate; after a process interruption, the plugin checks the actual name to recover progress.
- Each processing operation allows up to three attempts. Each model request has a 15-second timeout, and Herdr CLI calls have a 10-second timeout. With Jev enabled, new tasks usually require two sequential model calls.
- If all processing processes exit, remaining requests need a later event or manual action to resume. The plugin has no persistent polling service.
- If a process stops after a model response but before saving the result, recovery may call the model again.
- Herdr 0.9.3 has no atomic rename API conditional on the session. The plugin checks the target before and after renaming, but a race window remains between the check and the rename.
- External manual renames pause automatic naming. Name queries alone cannot detect a manual rename that returns to the original value or matches the pending candidate name.

### Privacy

Model input includes the current task summary, name, necessary recent text, and new text. The plugin redacts configured keys, some common tokens, private keys, and credential assignment patterns. Redaction catches only some secrets; confirm the service's data handling scope before sending input.

Logs contain status, request sequence numbers, and a restricted set of error codes. They omit full task text, service error responses, and keys. Persisted state contains summaries, message IDs, names, and pending results, but omits full message text. Summaries may still contain sensitive information, so protect the state directory.

## Development and contributing

```bash
npm ci
npm run check
npm test
```

Tests cover task processing, provider configuration, Jev routing, concurrency control, failure recovery, and cross-process integration using mock CLI and HTTP services. Automated tests require no real API keys. Classification quality, cost, latency, and Herdr event timing must be verified in a live environment.

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

When reporting an issue, include your Node.js, Herdr, and Pi versions, reproduction steps, and redacted error codes. Before submitting changes, run the checks above and add tests for behavior changes.

## License

This project is licensed under the [MIT License](LICENSE).

## References

- [Herdr plugin documentation (0.9.3)](https://raw.githubusercontent.com/herdrdev/herdr/v0.9.3/docs/next/website/src/content/docs/plugins.mdx)
- [DeepSeek API documentation](https://api-docs.deepseek.com/)
- [TypeSafe Choice documentation](https://docs.typesafe.ai/primitives/choice)
