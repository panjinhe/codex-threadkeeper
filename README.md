<div align="center">

# codex-provider-sync

### Keep Codex history visible after switching between providers

[![CI](https://github.com/Dailin521/codex-provider-sync/actions/workflows/ci.yml/badge.svg)](https://github.com/Dailin521/codex-provider-sync/actions/workflows/ci.yml)
[![Platform](https://img.shields.io/badge/platform-Windows-lightgrey.svg)](https://github.com/Dailin521/codex-provider-sync)
[![Node](https://img.shields.io/badge/node-24%2B-brightgreen.svg)](https://nodejs.org/)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Community](https://img.shields.io/badge/community-LINUX%20DO-2ea043.svg)](https://linux.do/)

English | [中文](README_ZH.md)

</div>

## What It Solves

Codex session visibility can break after you switch `model_provider`.

Typical symptom:

- old sessions are visible under one provider
- then disappear after switching to another provider
- `codex resume` and Codex App may disagree because session metadata is stored in both rollout files and SQLite

`codex-provider-sync` fixes that by updating both:

- `~/.codex/sessions` and `~/.codex/archived_sessions`
- `~/.codex/state_5.sqlite`

## Install

```bash
npm install -g github:Dailin521/codex-provider-sync
```

Requirements:

- Node.js `24+`
- standard `~/.codex` layout
- Windows is the primary tested target for now

## Quick Start

If you already switched auth/provider using your usual method:

```bash
codex-provider sync
```

If you want to change the root `model_provider` and sync history in one step:

```bash
codex-provider switch openai
codex-provider switch apigather
```

Check current state first:

```bash
codex-provider status
```

Rollback from a backup:

```bash
codex-provider restore C:\Users\you\.codex\backups_state\provider-sync\<timestamp>
```

## AI Quick Run

If you want an AI assistant to handle this in one shot, copy this prompt:

```text
Help me fix Codex session visibility with codex-provider-sync.

Steps:
1. Run `codex-provider status`.
2. If my current provider is already correct, run `codex-provider sync`.
3. If I explicitly want to switch provider, run `codex-provider switch <provider-id>` instead.
4. If `state_5.sqlite` is currently in use, tell me to close Codex / Codex App / app-server and retry.
5. If sync skips locked rollout files, tell me which files were skipped and remind me to rerun `codex-provider sync` later.
6. Summarize the final provider counts in rollout files and SQLite.
```

Quick mapping:

- inspect only: `codex-provider status`
- fix visibility under current provider: `codex-provider sync`
- switch provider and sync: `codex-provider switch openai`
- roll back a mistake: `codex-provider restore <backup-dir>`

## Commands

- `codex-provider status`
  - shows current provider and provider distribution in rollout files and SQLite
- `codex-provider sync`
  - syncs history to the current provider
  - `--provider <id>` overrides the target provider
  - if root `model_provider` is missing, it falls back to `openai`
- `codex-provider switch <provider-id>`
  - updates root `model_provider` in `config.toml`
  - immediately runs a sync
- `codex-provider restore <backup-dir>`
  - restores a previous backup

```bash
codex-provider status
codex-provider sync
codex-provider sync --provider openai
codex-provider switch openai
codex-provider switch apigather
codex-provider restore C:\Users\you\.codex\backups_state\provider-sync\20260319T042708906Z
codex-provider status --codex-home C:\Users\you\.codex
codex-provider sync --codex-home C:\Users\you\.codex
codex-provider switch apigather --codex-home C:\Users\you\.codex
codex-provider restore C:\Users\you\.codex\backups_state\provider-sync\20260319T042708906Z
```

## Safety

Before each sync, the tool creates a backup under:

```text
~/.codex/backups_state/provider-sync/<timestamp>
```

It also uses:

```text
~/.codex/tmp/provider-sync.lock
```

- It does not replace official `codex`.
- It does not manage `auth.json` or third-party login tools.
- It does not rewrite message history, titles, cwd, or timestamps.
- If `state_5.sqlite` is in use, close Codex / Codex App / app-server and retry.
- If a live session keeps one rollout file open, `sync` skips that file and reports it. Rerun later.

## For AI Agents

For a fuller machine-oriented version, see [AGENTS.md](AGENTS.md).

## Development

```bash
git clone https://github.com/Dailin521/codex-provider-sync.git
cd codex-provider-sync
npm test
node ./src/cli.js status --codex-home C:\path\to\.codex
```

## License

MIT
