# Herdr Auto Name

根据当前任务，自动为 [Herdr](https://herdr.dev) 中的 Pi agent 设置简短英文名称。同一任务保留名称，主要目标变化时更新名称。

| 用户输入 | 预期行为 |
| --- | --- |
| “修复登录失败” | 命名为 `fix-login` |
| “继续”“加测试”“提交这些修改” | 保留名称 |
| “接下来处理支付超时” | 更新为 `fix-payment-timeout` |
| 信息不足或只有图片 | 保留名称 |

任务判断由模型完成，实际名称可能与示例不同。判断有误时，可以手动重新命名或暂停自动命名。

## 功能

- 监听 Herdr agent 检测和状态变化事件，检查新增任务。
- 使用 DeepSeek 或 OpenAI 判断任务并生成名称。
- 可选使用 TypeSafe Jev 先做任务分类，仅在需要新名称时调用普通模型。
- 保存处理进度，跳过已处理消息，重试失败操作。
- 检测外部手动改名，并暂停本会话的自动命名。
- 提供重新命名、暂停和恢复操作，可绑定快捷键。

## 环境要求

| 项目 | 要求 |
| --- | --- |
| 系统 | macOS |
| Node.js | 22 或更新版本；Herdr 插件进程的 `PATH` 中需要有 `node` |
| Herdr | 0.9.3 或更新版本；已验证版本为 0.9.3 |
| Agent | 本机 Pi；会话解析基于 Pi 1.0.0 的 v3 JSONL 格式 |
| 模型服务 | DeepSeek 或 OpenAI；Jev 分类为可选功能 |

Herdr 需要能上报 Pi 的本机会话文件路径。插件只读该文件，使用独立的 Herdr 插件入口，无需修改 Herdr 托管的 Pi 集成。

## 快速开始

> **隐私提示：** 插件会将必要的任务文本和摘要发送到所配置的模型服务。启用前，请确认相关会话允许使用这些服务。启用 Jev 后，任务文本也会发送到 TypeSafe。

### 1. 安装依赖并链接插件

下载项目后，在项目根目录执行：

```bash
npm ci
herdr plugin link "$PWD" --disabled
```

先以禁用状态链接，完成配置后再启用。插件 ID 为 `local.auto-name`。

### 2. 写入配置

查询配置目录，并复制示例文件：

```bash
herdr plugin config-dir local.auto-name
```

将 [`config.example.json`](config.example.json) 复制到该目录，命名为 `config.json`：

```json
{
  "provider": "deepseek",
  "model": "deepseek-flash"
}
```

这份配置使用 DeepSeek 完成任务判断和命名。服务地址与密钥环境变量由 provider 自动选择。

### 3. 设置密钥

| Provider | 密钥环境变量 | 用途 |
| --- | --- | --- |
| `deepseek` | `DEEPSEEK_API_KEY` | 任务判断和命名 |
| `openai` | `OPENAI_API_KEY` | 任务判断和命名 |
| `typesafe` | `TYPESAFE_API_KEY` | 可选的 Jev 分类 |

密钥必须存在于 **Herdr 启动插件时的环境**。请通过自己的 Herdr 启动方式或环境管理工具设置变量。

在已运行的 pane 中执行 `export`，通常只会影响该 pane 的子进程，现有 Herdr 服务进程仍使用原环境。验证时应检查插件日志。不要为了更新变量而中断正在工作的 Herdr 服务。

插件从环境变量读取密钥，不读取 Pi 的登录存储。请勿将密钥写入项目文件或提交到版本库。

### 4. 启用并验证

```bash
herdr plugin enable local.auto-name
herdr plugin list --plugin local.auto-name --json
```

确认输出包含 `"enabled": true`。后续 agent 检测和状态变化事件会触发检查；启用操作本身不会立即检查当前任务。

在目标 Pi pane 中执行一次手动命名，再查看日志和名称：

```bash
herdr plugin action invoke local.auto-name.rename
herdr plugin log list --plugin local.auto-name --limit 20
herdr agent list
```

启用后，插件会处理该 Herdr 服务中符合条件的本机 Pi agent。请确认作用范围，而非只检查当前 pane。

## 配置

### 可选：Jev 分类，普通模型命名

使用 [`config.jev.example.json`](config.jev.example.json)：

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

此配置需要同时设置 `DEEPSEEK_API_KEY` 和 `TYPESAFE_API_KEY`。

| 情况 | 处理方式 |
| --- | --- |
| 省略 `classifier` | 普通模型在一次调用中完成判断和命名 |
| Jev 判断为同一任务或信息不足 | 保留名称和已有摘要，省去普通模型调用 |
| Jev 判断为新任务 | 普通模型生成名称和摘要 |
| 手动重新命名或恢复 | 直接调用普通模型，便于纠正分类结果 |
| 已配置的 Jev 调用失败 | 保留名称并重试，继续使用所选服务 |

Jev 使用 TypeSafe 的 `/systemone` 接口，当前支持 `typesafe` provider 的 `jev-latest` 模型。

### 普通模型与自定义地址

顶层 `provider` 支持 `deepseek` 和 `openai`，`model` 填写该服务提供的模型 ID。普通模型需要支持 Chat Completions、`response_format: {"type":"json_object"}` 和 `max_tokens`。DeepSeek 调用关闭思考模式。

默认地址：

| Provider | 地址 |
| --- | --- |
| `deepseek` | `https://api.deepseek.com` |
| `openai` | `https://api.openai.com/v1` |
| `typesafe` | `https://api.typesafe.ai/v1` |

使用代理服务时，可在顶层配置或 `classifier` 对象中添加 `baseUrl`。代码分别追加 `/chat/completions` 或 `/systemone`。密钥仍从对应 provider 的环境变量读取。

远程地址要求 HTTPS。HTTP 仅支持 `localhost`、`127.0.0.1` 和 `::1`。

## 日常操作

在目标 Pi pane 中执行，并核对实际作用对象：

| 操作 | 命令 |
| --- | --- |
| 重新命名 | `herdr plugin action invoke local.auto-name.rename` |
| 暂停自动命名 | `herdr plugin action invoke local.auto-name.pause` |
| 恢复自动命名 | `herdr plugin action invoke local.auto-name.resume` |

暂停时仍可执行一次手动重新命名，之后保持暂停。恢复操作会认可当前名称作为新基线，并重新检查任务。较新的控制请求会取代较旧的请求。

在 Herdr 配置中添加快捷键：

```toml
[[keys.command]]
key = "prefix+n"
type = "plugin_action"
command = "local.auto-name.rename"
description = "rename current agent"
```

停用插件或解除链接：

```bash
herdr plugin disable local.auto-name
herdr plugin unlink local.auto-name
```

## 故障排查

先查看插件状态和运行日志：

```bash
herdr plugin list --plugin local.auto-name --json
herdr plugin log list --plugin local.auto-name --limit 20
```

| 现象或错误码 | 检查方式 |
| --- | --- |
| 启用后名称未变化 | 启用不会立即触发检查。执行一次手动重新命名，并查看日志 |
| `model_credentials_missing` | 检查 Herdr 插件进程是否能读取所需密钥变量 |
| `config_missing_or_invalid` | 检查配置目录中是否有有效的 `config.json` |
| `model_http_401` / `model_http_403` | 检查密钥有效性及服务访问权限 |
| `model_unavailable` | 检查服务地址、网络和请求超时 |
| `external_name_paused` / `paused` | 确认是否需要保留人工名称；需要继续自动命名时执行恢复 |
| `target_shared_session` | 同一个会话被多个 pane 使用；解除冲突后重试 |
| `session_no_text` | 当前待处理输入没有可用文本；补充文字任务 |
| `session_size_limit` / `model_input_limit` | 会话文件或模型输入超过当前限制 |
| `unchanged` | 当前消息版本已处理，无需重复命名 |

## 工作原理与限制

插件读取最后持久化分支上的 user 消息，并按以下流程处理：

```text
事件或手动操作 → 请求入队 → 读取会话 → 判断任务
  → 必要时生成名称 → 重新检查目标和消息 → 改名并确认 → 保存进度
```

### 触发与会话范围

- 监听 `pane.agent_detected` 和 `pane.agent_status_changed`。工作中追加消息若没有引起状态变化，要等下一个事件或手动操作。
- 仅支持本机绝对路径和 v3 JSONL 会话文件。远程会话和仅提供会话 ID 的情况暂未支持。
- 沿 `parentId` 读取最后持久化分支。Pi 只在内存中切换分支时，插件需要等后续写入才能观察到变化。
- 排除 assistant、工具和 `custom_message`。扩展通过 `sendUserMessage()` 写入的消息与普通 user 消息格式相同，来源无法可靠区分。
- 只读取完整 JSONL 行。纯图片输入保留名称；混合输入只使用文本。
- 每次完整读取文件，上限为 32 MiB。首次接管、分支变化和手动命名使用最近 8 条 user 消息；常规增量使用全部新增消息及最多 4 条近期消息。模型输入上限为 24,000 字符。

### 失败恢复

- 同一 Herdr 服务中的请求串行处理。状态和待处理请求保存在 `HERDR_PLUGIN_STATE_DIR`。
- 先保存候选名称，再执行改名。改名失败后复用候选结果；进程中断后核对实际名称，恢复处理进度。
- 每次处理最多尝试三次。每个模型请求超时为 15 秒，Herdr CLI 超时为 10 秒。启用 Jev 后，新任务通常需要两次顺序模型调用。
- 所有处理进程退出后，遗留请求需要后续事件或手动操作唤醒。插件没有常驻轮询服务。
- 模型返回后、结果保存前若进程中断，恢复时可能再次调用模型。
- Herdr 0.9.3 缺少按会话条件执行的原子改名接口。改名前后会核对目标，但检查与改名之间仍存在竞争窗口。
- 外部手动改名会触发暂停。名称改回原值，或恰好等于待应用名称时，仅靠名称查询无法识别该操作。

### 隐私

模型输入包含当前任务摘要、名称、必要近期文本和新增文本。插件会脱敏已配置的密钥、部分常见 token、私钥及凭据赋值形式。脱敏只能识别部分秘密，请在发送前确认服务的数据使用范围。

日志记录状态、请求序号和受限错误码，省略完整任务文本、服务错误响应和密钥。持久化状态保存摘要、消息 ID、名称和待应用结果，省略完整消息文本。摘要仍可能包含敏感信息，请保护状态目录。

## 开发与贡献

```bash
npm ci
npm run check
npm test
```

测试覆盖任务处理、provider 配置、Jev 路由、并发控制、失败恢复，以及使用模拟 CLI 和 HTTP 服务的跨进程集成。自动化测试无需真实 API Key。真实模型的分类质量、成本、延迟和 Herdr 事件时序需要在实际环境中验证。

| 路径 | 职责 |
| --- | --- |
| `herdr-plugin.toml` | 操作和事件入口 |
| `src/main.mjs` | 入队、串行消费和有限重试 |
| `src/herdr.mjs` | Herdr CLI 与调用上下文 |
| `src/engine.mjs` | 任务状态、人工名称保护和恢复 |
| `src/pi-session.mjs` | 只读会话解析 |
| `src/naming.mjs` | Provider 配置、模型调用、脱敏和名称校验 |
| `src/state.mjs` | 状态文件、队列和锁 |
| `test/` | 单元测试与集成测试 |

提交问题时，请附上 Node.js、Herdr 和 Pi 版本、复现步骤，以及脱敏后的错误码。提交改动前，请运行上述检查，并为行为变化补充测试。

## 许可证

本项目采用 [MIT 许可证](LICENSE)。

## 参考资料

- [Herdr 插件文档（0.9.3）](https://raw.githubusercontent.com/herdrdev/herdr/v0.9.3/docs/next/website/src/content/docs/plugins.mdx)
- [DeepSeek API 文档](https://api-docs.deepseek.com/)
- [TypeSafe Choice 文档](https://docs.typesafe.ai/primitives/choice)
