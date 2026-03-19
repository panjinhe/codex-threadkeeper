<div align="center">

# codex-provider-sync

### 在切换 provider 之后，让 Codex 的历史会话重新可见

[![CI](https://github.com/Dailin521/codex-provider-sync/actions/workflows/ci.yml/badge.svg)](https://github.com/Dailin521/codex-provider-sync/actions/workflows/ci.yml)
[![Platform](https://img.shields.io/badge/platform-Windows-lightgrey.svg)](https://github.com/Dailin521/codex-provider-sync)
[![Node](https://img.shields.io/badge/node-24%2B-brightgreen.svg)](https://nodejs.org/)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

[English](README.md) | 中文

</div>

## 这个工具解决什么问题

Codex 的会话元数据并不只保存在一个地方，而是分成两层：

- `~/.codex/sessions` 和 `~/.codex/archived_sessions` 下面的 rollout 文件
- `~/.codex/state_5.sqlite` 里的线程索引数据

当你切换 `model_provider` 之后，Codex 的会话选择器、`resume` / `fork`，以及走 SQLite 线程列表的界面，可能只显示“当前 provider 对应的历史会话”。

典型现象就是：

1. 你先用官方 `openai` 登录了一段时间。
2. 后来切到中转或自定义 provider，比如 `apigather`、`newapi`。
3. 再打开 `codex resume`、`codex fork`，或者相关的 App / app-server 会话列表。
4. 之前的历史会话像“消失了一样”。

`codex-provider-sync` 的作用，就是把这些历史会话里保存的 provider 元数据统一改成“你现在正在使用的 provider”，让官方 Codex 再次能看到它们。

## 它会做什么

这个工具会同时更新 Codex 会话发现依赖的两层数据：

- 重写以下目录里每个 rollout 文件的首行 `session_meta.model_provider`
  - `~/.codex/sessions`
  - `~/.codex/archived_sessions`
- 更新 `~/.codex/state_5.sqlite` 里的 `threads.model_provider`

同时还会：

- 每次同步前自动备份
- 运行期间创建锁目录，避免并发修改
- 提供 `restore` 回滚命令
- 如果当前 Codex/App 会话正占用某个 rollout 文件，`sync` 会跳过它并在结果里列出来

它**不会**：

- 替换官方 `codex` 命令
- 自动帮你处理 `auth.json` 或第三方切号工具
- 自动创建 `config.toml` 里的 provider 定义

## 为什么不能只改 sessions 文件

这是这个问题里最容易踩坑的一点。

只改 `~/.codex/sessions/*.jsonl` 并不可靠，因为：

- Codex 很多线程列表优先读 `state_5.sqlite`
- 如果只改 rollout 文件，不改 SQLite，文件层和数据库层就会不一致
- 这时某些入口能看到会话，某些入口还是看不到

所以这个工具不是“单改 jsonl”，而是：

- 文件层一起改
- SQLite 一起改
- 备份一起做

## 工作方式

这个工具提供四个命令：

- `codex-provider status`
  - 查看当前 `config.toml` 使用的 provider
  - 查看 rollout 文件和 SQLite 里各 provider 的分布情况
- `codex-provider sync`
  - 把全部历史会话同步到当前 provider
  - 或者同步到 `--provider <id>` 指定的 provider
- `codex-provider switch <provider-id>`
  - 先改 `config.toml` 根级的 `model_provider`
  - 再立即执行一次完整同步
- `codex-provider restore <backup-dir>`
  - 从历史备份恢复 rollout 元数据和 SQLite 状态

## 安装方式

### 方式 1：直接从 GitHub 安装

```bash
npm install -g github:Dailin521/codex-provider-sync
```

### 方式 2：克隆后本地安装

```bash
git clone https://github.com/Dailin521/codex-provider-sync.git
cd codex-provider-sync
npm install -g .
```

### 环境要求

- Node.js `24+`
- Codex 使用标准 `~/.codex` 存储结构
- 建议运行 `sync` / `restore` 前，先关闭 Codex、app-server、相关 App
- 如果某个活跃会话仍然占着 rollout 文件，`sync` 会跳过该文件并继续处理其余历史会话

## 快速开始

### 最常见的用法

如果你已经用自己的方式切好了 provider 或认证状态，直接执行：

```bash
codex-provider sync
```

它会：

- 从 `~/.codex/config.toml` 读取当前 provider
- 把历史会话元数据全部同步到这个 provider
- 让官方 Codex 的会话列表重新看到这些历史会话

### 一步切换 provider 并同步历史

前提是目标 provider 已经存在于 `config.toml` 里：

```bash
codex-provider switch openai
codex-provider switch apigather
```

### 先看当前状态再决定是否同步

```bash
codex-provider status
```

示例输出：

```text
Codex home: C:\Users\you\.codex
Current provider: openai
Configured providers: apigather, openai

Rollout files:
  sessions: apigather: 199, openai: 135
  archived_sessions: apigather: 2, openai: 10

SQLite state:
  sessions: apigather: 199, openai: 135
  archived_sessions: apigather: 2, openai: 10
```

## 命令说明

### `codex-provider status`

显示：

- `config.toml` 当前 provider
- 当前已配置的 provider 列表
- rollout 文件里的 provider 分布
- SQLite 里的 provider 分布

```bash
codex-provider status
codex-provider status --codex-home C:\Users\you\.codex
```

### `codex-provider sync`

把全部历史会话同步到当前 provider，或者同步到手动指定的 provider。

如果 `~/.codex/config.toml` 根级没有 `model_provider`，`sync` 会默认按 `openai` 处理。

```bash
codex-provider sync
codex-provider sync --provider openai
codex-provider sync --provider apigather
codex-provider sync --codex-home C:\Users\you\.codex
```

适合这些场景：

- 你已经通过别的工具切好了认证或 provider
- 你手动改了 `config.toml`
- 你只想重新统一历史会话，不想再次改配置

### `codex-provider switch <provider-id>`

先修改 `config.toml` 根级 `model_provider`，再同步全部历史会话。

```bash
codex-provider switch openai
codex-provider switch apigather
codex-provider switch newapi
```

注意：

- `openai` 视为内置可用 provider
- 自定义 provider 必须已经存在于 `config.toml` 的 `[model_providers.<id>]`
- 这个命令不会替你做登录，也不会接管第三方切号工具

### `codex-provider restore <backup-dir>`

如果你同步错了 provider，可以直接从备份恢复。

```bash
codex-provider restore C:\Users\you\.codex\backups_state\provider-sync\20260319T042708906Z
```

## 推荐使用方式

### 官方登录和中转切换混用

如果你有时用官方 `openai`，有时用中转 provider：

1. 先按你原本的方式完成认证切换。
2. 确保 `config.toml` 里当前指向的是你要使用的 provider。
3. 执行：

```bash
codex-provider sync
```

4. 再去打开官方 Codex 的会话列表。

### 你想用一条命令完成切换和统一

如果目标 provider 已经在 `config.toml` 中定义好了，直接：

```bash
codex-provider switch <provider-id>
```

### 你已经有自己的切换工具

比如：

- 官方 `codex login`
- 手动改配置
- 你自己的脚本
- 第三方切换工具

那就把 `codex-provider-sync` 当成最后一步的“历史会话归一化”工具即可：

```bash
codex-provider sync
```

## 安全、备份和回滚

每次同步前，工具都会在这里创建备份：

```text
~/.codex/backups_state/provider-sync/<timestamp>
```

备份里包含：

- `state_5.sqlite`
- 如果存在，也会备份 `state_5.sqlite-shm` 和 `state_5.sqlite-wal`
- 每个被修改 rollout 文件的原始首行内容
- 一份 `config.toml`

运行期间还会在这里创建锁目录：

```text
~/.codex/tmp/provider-sync.lock
```

如果你遇到 lock 错误：

- 先关闭 Codex 和相关界面
- 确认没有同步正在运行
- 再重试

## FAQ

### 它会修改我的对话内容吗？

不会。

它只会修改“会话发现依赖的 provider 元数据”，不会重写：

- thread id
- 消息历史
- 标题
- cwd
- 时间戳

### 它会替代官方 `codex` 吗？

不会。

你仍然照常使用官方 `codex`。这个工具只是把历史会话的 provider 元数据统一好，让官方 Codex 再次能看到它们。

### 这个对 App / app-server 的会话列表也有用吗？

只要对方读取的是标准 `.codex` 会话存储，那么“同步 rollout 文件 + 同步 SQLite”就是让这些历史会话重新可见的关键步骤。

### `switch` 会自动帮我登录 provider 吗？

不会。

`switch` 只做两件事：

- 修改 `config.toml` 的根级 `model_provider`
- 把全部历史会话同步到这个 provider

认证仍然需要你自己处理。

### `state_5.sqlite is currently in use` 是什么意思？

这表示官方 Codex、Codex App，或者其他进程还占着 SQLite 状态库。

先把 Codex、Codex App、app-server 之类相关进程关掉，再重新执行 `sync` 或 `restore`。

### 如果当前会话锁住了某个 rollout 文件怎么办？

`sync` 会跳过被锁住的 rollout 文件，并继续更新其它历史会话以及 SQLite。

命令输出里会直接列出被跳过的文件路径。等当前会话结束后，再补跑一次 `sync`，就能把这些文件也统一掉。

### 为什么我的自定义 provider 不被接受？

`switch <provider-id>` 会校验 provider 是否已经存在于 `config.toml`，内置 `openai` 除外。

如果报不存在：

1. 先把 provider 写进 `config.toml`
2. 或者先通过你原本的工具切换
3. 再执行 `codex-provider sync`

## 开发

```bash
git clone https://github.com/Dailin521/codex-provider-sync.git
cd codex-provider-sync
npm test
node ./src/cli.js status --codex-home C:\path\to\.codex
```

当前实现说明：

- 纯 Node.js
- 使用内置 `node:sqlite`
- 以 Windows 为首测平台

## License

MIT
