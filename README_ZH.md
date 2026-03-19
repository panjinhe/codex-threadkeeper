<div align="center">

# codex-provider-sync

### 在切换 provider 之后，让 Codex 的历史会话重新可见

[![CI](https://github.com/Dailin521/codex-provider-sync/actions/workflows/ci.yml/badge.svg)](https://github.com/Dailin521/codex-provider-sync/actions/workflows/ci.yml)
[![Platform](https://img.shields.io/badge/platform-Windows-lightgrey.svg)](https://github.com/Dailin521/codex-provider-sync)
[![Node](https://img.shields.io/badge/node-24%2B-brightgreen.svg)](https://nodejs.org/)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Community](https://img.shields.io/badge/community-LINUX%20DO-2ea043.svg)](https://linux.do/)

[English](README.md) | 中文

</div>

## 解决什么问题

切换 `model_provider` 之后，Codex 的历史会话有时会“消失”。

常见现象：

- `codex resume` 里能看到的会话，到了 Codex App 里不一定还能看到
- 切回官方 `openai` 后，之前在中转 provider 下的历史会话像没了
- 只改 `sessions/*.jsonl` 不够，因为 SQLite 里还有一层 provider 元数据

`codex-provider-sync` 会把这两层一起同步：

- `~/.codex/sessions` 和 `~/.codex/archived_sessions`
- `~/.codex/state_5.sqlite`

## 安装

```bash
npm install -g github:Dailin521/codex-provider-sync
```

环境要求：

- Node.js `24+`
- 标准 `~/.codex` 目录结构
- 当前优先面向 Windows 使用场景

## 快速开始

如果你已经用自己的方式切好了 provider 或认证状态，直接执行：

```bash
codex-provider sync
```

如果你想顺手改 `config.toml` 里的根级 `model_provider`，再同步全部历史会话：

```bash
codex-provider switch openai
codex-provider switch apigather
```

先看当前状态：

```bash
codex-provider status
```

从备份回滚：

```bash
codex-provider restore C:\Users\you\.codex\backups_state\provider-sync\<timestamp>
```

## AI 一键处理

如果你想直接交给 AI 助手处理，把下面这段原样发给 AI：

```text
请帮我用 codex-provider-sync 修复 Codex 历史会话在当前 provider 下不可见的问题。

步骤：
1. 先运行 `codex-provider status`。
2. 如果当前 provider 已经正确，就运行 `codex-provider sync`。
3. 如果我明确说要切到某个 provider，就改为运行 `codex-provider switch <provider-id>`。
4. 如果提示 `state_5.sqlite` 正在被占用，就提醒我先关闭 Codex / Codex App / app-server 再重试。
5. 如果 sync 跳过了被锁住的 rollout 文件，就告诉我哪些文件被跳过了，并提醒我稍后再补跑一次 `codex-provider sync`。
6. 最后总结 rollout files 和 SQLite 里的 provider 状态。
```

快速对应关系：

- 只想查看状态：`codex-provider status`
- 当前 provider 不变，只修复历史会话可见性：`codex-provider sync`
- 切 provider 并同步历史：`codex-provider switch openai`
- 回滚误操作：`codex-provider restore <backup-dir>`

## 命令说明

- `codex-provider status`
  - 显示当前 provider，以及 rollout 文件和 SQLite 里的 provider 分布
- `codex-provider sync`
  - 把历史会话同步到当前 provider
  - `--provider <id>` 可手动指定目标 provider
  - 如果根级 `model_provider` 缺失，会默认按 `openai` 处理
- `codex-provider switch <provider-id>`
  - 修改 `config.toml` 根级 `model_provider`
  - 然后立即执行一次同步
- `codex-provider restore <backup-dir>`
  - 从历史备份恢复

常见用法：

```bash
codex-provider status
codex-provider sync
codex-provider sync --provider openai
codex-provider switch apigather
codex-provider restore C:\Users\you\.codex\backups_state\provider-sync\20260319T042708906Z
```

## 安全说明

每次同步前，工具都会先备份到：

```text
~/.codex/backups_state/provider-sync/<timestamp>
```

运行期间会使用：

```text
~/.codex/tmp/provider-sync.lock
```

注意：

- 它不会替换官方 `codex`
- 它不会帮你处理 `auth.json` 或第三方切号工具
- 它不会改消息历史、标题、cwd、时间戳
- 如果 `state_5.sqlite` 被占用，先关闭 Codex / Codex App / app-server 再重试
- 如果当前活跃会话锁住了某个 rollout 文件，`sync` 会跳过该文件并继续处理其它历史会话

## 给 AI / Agent 的说明

更完整的机器说明见 [AGENTS.md](AGENTS.md)。

## 开发

```bash
git clone https://github.com/Dailin521/codex-provider-sync.git
cd codex-provider-sync
npm test
node ./src/cli.js status --codex-home C:\path\to\.codex
```

## License

MIT
