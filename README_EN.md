<div align="center">

# codex-threadkeeper

### Keep Codex threads visible and recoverable across provider changes

[![CI](https://github.com/panjinhe/codex-threadkeeper/actions/workflows/ci.yml/badge.svg)](https://github.com/panjinhe/codex-threadkeeper/actions/workflows/ci.yml)
[![Platform](https://img.shields.io/badge/platform-Windows-lightgrey.svg)](https://github.com/panjinhe/codex-threadkeeper)
[![Node](https://img.shields.io/badge/node-24%2B-brightgreen.svg)](https://nodejs.org/)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Community](https://img.shields.io/badge/community-LINUX%20DO-2ea043.svg)](https://linux.do/)

English | [中文](README.md)

</div>

## What It Solves

Codex thread visibility can break after you switch `model_provider`.

Typical symptom:

- old sessions are visible under one provider
- then disappear after switching to another provider
- the sidebar can lose project roots even though the sessions still exist
- `codex resume` and Codex App may disagree because thread metadata is spread across rollout files, SQLite, and sidebar state

`codex-threadkeeper` keeps that state aligned by updating:

- `~/.codex/sessions` and `~/.codex/archived_sessions`
- `~/.codex/state_5.sqlite`
- managed backups under `~/.codex/backups_state/threadkeeper`

## GUI For Windows

If you want a normal Windows app instead of Node/npm, download `CodexThreadkeeper.exe` from Releases.

The GUI app:

- scans the current `.codex` home
- shows provider distribution from rollout files and SQLite
- lets you choose a target provider from detected and saved providers
- can optionally update root `model_provider` in `config.toml`
- keeps the latest 5 managed backups by default, with a configurable retention count
- can manually clean old managed backups from the app
- can restore from backup without using a terminal

For GUI-specific usage notes, see [README_GUI_ZH.md](README_GUI_ZH.md).

## Install

```bash
npm install -g github:panjinhe/codex-threadkeeper
```

Requirements:

- Node.js `24+`
- standard `~/.codex` layout
- Windows is the primary tested target for now

For end users, the GUI EXE is the recommended path. The npm CLI remains available for power users and automation.

## Quick Start

GUI:

- download `CodexThreadkeeper.exe` from Releases
- open it and click `Refresh`
- choose the target provider
- click `Execute`

If you already switched auth/provider using your usual method:

```bash
codex-threadkeeper sync
```

If you want to change the root `model_provider` and sync history in one step:

```bash
codex-threadkeeper switch openai
codex-threadkeeper switch apigather
```

If you want a different automatic backup retention count for one run:

```bash
codex-threadkeeper sync --keep 5
codex-threadkeeper switch apigather --keep 10
```

Check current state first:

```bash
codex-threadkeeper status
```

Install a Windows double-click launcher (placed on your Desktop by default):

```bash
codex-threadkeeper install-windows-launcher
```

Rollback from a backup:

```bash
codex-threadkeeper restore C:\Users\you\.codex\backups_state\threadkeeper\<timestamp>
```

Clean old managed backups manually:

```bash
codex-threadkeeper prune-backups --keep 5
```

## AI Quick Run

If you want an AI assistant to handle this in one shot, copy this prompt:

```text
Help me fix Codex session visibility with codex-threadkeeper.

Steps:
1. Run `codex-threadkeeper status`.
2. If my current provider is already correct, run `codex-threadkeeper sync`.
3. If I explicitly want to switch provider, run `codex-threadkeeper switch <provider-id>` instead.
4. If `state_5.sqlite` is currently in use, tell me to close Codex / Codex App / app-server and retry.
5. If sync skips locked rollout files, tell me which files were skipped and remind me to rerun `codex-threadkeeper sync` later.
6. Summarize the final provider counts in rollout files and SQLite.
```

If the user prefers the GUI, the AI can instead guide these steps:

1. Open `CodexThreadkeeper.exe`
2. Confirm the `.codex` path
3. Click `Refresh`
4. Pick the target provider from the list
5. Enable the config checkbox only if root `model_provider` should also change
6. Click `Execute`
7. Read the log panel for backup path, updated rollout files, SQLite rows, and skipped locked files

Quick mapping:

- inspect only: `codex-threadkeeper status`
- fix visibility under current provider: `codex-threadkeeper sync`
- switch provider and sync: `codex-threadkeeper switch openai`
- install a desktop double-click launcher: `codex-threadkeeper install-windows-launcher`
- roll back a mistake: `codex-threadkeeper restore <backup-dir>`

## Commands

- `codex-threadkeeper status`
  - shows current provider and provider distribution in rollout files and SQLite
- `codex-threadkeeper sync`
  - syncs history to the current provider
  - `--provider <id>` overrides the target provider
  - if root `model_provider` is missing, it falls back to `openai`
- `codex-threadkeeper switch <provider-id>`
  - updates root `model_provider` in `config.toml`
  - immediately runs a sync
  - `--keep <n>` overrides how many managed backups are retained after the run
- `codex-threadkeeper prune-backups`
  - manually removes older managed backups and keeps the newest `n`
- `codex-threadkeeper restore <backup-dir>`
  - restores a previous backup
- `codex-threadkeeper install-windows-launcher`
  - creates two files on the Desktop by default
  - `Codex Threadkeeper.vbs`: hidden double-click launcher with a result popup
  - `Codex Threadkeeper.cmd`: visible console version for troubleshooting
  - use `--dir <path>` to choose another install directory
  - use `--codex-home <path>` to bake a fixed `CODEX_HOME` into the launcher

```bash
codex-threadkeeper status
codex-threadkeeper sync
codex-threadkeeper sync --keep 5
codex-threadkeeper sync --provider openai
codex-threadkeeper switch openai
codex-threadkeeper switch apigather
codex-threadkeeper prune-backups --keep 5
codex-threadkeeper install-windows-launcher
codex-threadkeeper install-windows-launcher --dir D:\Tools
codex-threadkeeper install-windows-launcher --codex-home C:\Users\you\.codex
codex-threadkeeper restore C:\Users\you\.codex\backups_state\threadkeeper\20260319T042708906Z
codex-threadkeeper status --codex-home C:\Users\you\.codex
codex-threadkeeper sync --codex-home C:\Users\you\.codex
codex-threadkeeper switch apigather --codex-home C:\Users\you\.codex
codex-threadkeeper restore C:\Users\you\.codex\backups_state\threadkeeper\20260319T042708906Z
```

## Safety

Before each sync, the tool creates a backup under:

```text
~/.codex/backups_state/threadkeeper/<timestamp>
```

It also uses:

```text
~/.codex/tmp/threadkeeper.lock
```

- It does not replace official `codex`.
- It does not manage `auth.json` or third-party login tools.
- It does not rewrite message history, titles, cwd, or timestamps.
- It keeps the newest 5 managed backups by default; GUI retention settings or CLI `--keep <n>` can override that.
- Manual cleanup and auto-prune only touch backups created by this tool inside `backups_state/threadkeeper`.
- Older `provider-sync` backups are not auto-discovered anymore, but `codex-threadkeeper restore <backup-dir>` still works if you pass the legacy backup path explicitly.
- `Codex Threadkeeper.vbs` assumes the `codex-threadkeeper` command is already available.
- If `state_5.sqlite` is in use, close Codex / Codex App / app-server and retry.
- If a live session keeps one rollout file open, `sync` skips that file and reports it. Rerun later.

## For AI Agents

For a fuller machine-oriented version, see [AGENTS.md](AGENTS.md).

## Development

```bash
git clone https://github.com/panjinhe/codex-threadkeeper.git
cd codex-threadkeeper
npm test
dotnet test desktop/CodexThreadkeeper.Core.Tests/CodexThreadkeeper.Core.Tests.csproj
pwsh ./scripts/publish-gui.ps1
node ./src/cli.js status --codex-home C:\path\to\.codex
```

## License

MIT
