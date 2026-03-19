<div align="center">

# codex-provider-sync

### Keep Codex history visible after switching between providers

[![CI](https://github.com/Dailin521/codex-provider-sync/actions/workflows/ci.yml/badge.svg)](https://github.com/Dailin521/codex-provider-sync/actions/workflows/ci.yml)
[![Platform](https://img.shields.io/badge/platform-Windows-lightgrey.svg)](https://github.com/Dailin521/codex-provider-sync)
[![Node](https://img.shields.io/badge/node-24%2B-brightgreen.svg)](https://nodejs.org/)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

English | [中文](README_ZH.md)

</div>

## Why This Exists

Codex stores session metadata in two places:

- rollout files under `~/.codex/sessions` and `~/.codex/archived_sessions`
- SQLite state in `~/.codex/state_5.sqlite`

When you switch `model_provider`, Codex session pickers and SQLite-backed thread lists may only show sessions whose stored `model_provider` matches the current provider.

That means a common workflow breaks:

1. Use official OpenAI login for a while.
2. Switch to a relay or custom provider such as `apigather` or `newapi`.
3. Open `codex resume`, `codex fork`, or a Codex app/app-server session list.
4. Old sessions appear to be missing.

`codex-provider-sync` fixes that by normalizing the stored provider metadata for your historical sessions to the provider you want to use now.

## What It Does

The tool updates both storage layers used by Codex session listing:

- rewrites the first `session_meta` line of every rollout file in:
  - `~/.codex/sessions`
  - `~/.codex/archived_sessions`
- updates `threads.model_provider` in:
  - `~/.codex/state_5.sqlite`

It also:

- creates a backup before every sync
- uses a lock directory to avoid concurrent modifications
- provides a restore command for rollback
- skips rollout files that are actively locked by the current Codex/App session, then reports them for a later retry

It does **not**:

- replace the official `codex` command
- manage `auth.json` or third-party login tools for you
- create provider definitions in `config.toml`

## How It Works

There are four commands:

- `codex-provider status`
  - Reads your current `model_provider` from `~/.codex/config.toml`
  - Counts provider distribution in rollout files and SQLite
- `codex-provider sync`
  - Syncs all historical sessions to the current provider, or to `--provider <id>` if specified
- `codex-provider switch <provider-id>`
  - Updates the root-level `model_provider` in `config.toml`
  - Immediately runs the same sync process
- `codex-provider restore <backup-dir>`
  - Restores both rollout metadata and SQLite state from a previous backup

Why file-only edits are not enough:

- Codex often uses `state_5.sqlite` for thread lists
- editing only `sessions/*.jsonl` can leave SQLite out of sync
- this tool updates both sides together

## Installation

### Option 1: Install directly from GitHub

```bash
npm install -g github:Dailin521/codex-provider-sync
```

### Option 2: Clone and install locally

```bash
git clone https://github.com/Dailin521/codex-provider-sync.git
cd codex-provider-sync
npm install -g .
```

### Requirements

- Node.js `24+`
- Codex using the standard `~/.codex` storage layout
- Recommended: close Codex / app-server / Codex App before running sync or restore
- If one live session still keeps its rollout file open, `sync` will skip that file and continue

## Quick Start

### Most common workflow

If you already switched auth/provider using your usual method:

```bash
codex-provider sync
```

That command:

- reads the current provider from `~/.codex/config.toml`
- rewrites historical session metadata to that provider
- makes those sessions visible again to official Codex session listings

### Switch provider and sync in one step

Use this when the target provider is already defined in `config.toml`:

```bash
codex-provider switch openai
codex-provider switch apigather
```

### Check current state before syncing

```bash
codex-provider status
```

Example output:

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

## Command Reference

### `codex-provider status`

Show:

- current provider from `config.toml`
- configured custom providers
- provider distribution in rollout files
- provider distribution in SQLite

```bash
codex-provider status
codex-provider status --codex-home C:\Users\you\.codex
```

### `codex-provider sync`

Sync all session metadata to the current provider or a manually specified provider.

If root-level `model_provider` is missing from `~/.codex/config.toml`, `sync` treats `openai` as the default provider.

```bash
codex-provider sync
codex-provider sync --provider openai
codex-provider sync --provider apigather
codex-provider sync --codex-home C:\Users\you\.codex
```

Use `sync` when:

- another tool already changed your auth or provider config
- you manually edited `config.toml`
- you want to resync history without changing config again

### `codex-provider switch <provider-id>`

Update root-level `model_provider` in `config.toml`, then sync all history to that provider.

```bash
codex-provider switch openai
codex-provider switch apigather
codex-provider switch newapi
```

Important:

- `openai` is always treated as available
- custom providers must already exist under `[model_providers.<id>]` in `config.toml`
- this command does not log you in or update external auth tools

### `codex-provider restore <backup-dir>`

Restore a previous backup if you synced to the wrong provider.

```bash
codex-provider restore C:\Users\you\.codex\backups_state\provider-sync\20260319T042708906Z
```

## Recommended Usage Patterns

### Official OpenAI login + relay switching

If you use official login sometimes and relay providers at other times:

1. Switch auth the way you normally do.
2. Make sure `config.toml` points to the provider you want to use now.
3. Run:

```bash
codex-provider sync
```

4. Open official Codex session listing again.

### You want one command to change provider and fix history

If your provider is already defined in `config.toml`:

```bash
codex-provider switch <provider-id>
```

### You use another provider-switching tool

For example:

- official `codex login`
- manual config edits
- your own automation
- third-party switchers

In that case, treat `codex-provider-sync` as the final metadata normalization step:

```bash
codex-provider sync
```

## Safety, Backup, and Restore

Before each sync, the tool creates a backup under:

```text
~/.codex/backups_state/provider-sync/<timestamp>
```

Each backup includes:

- a copy of `state_5.sqlite`
- `state_5.sqlite-shm` and `state_5.sqlite-wal` if present
- the original first line of every modified rollout file
- a copy of `config.toml`

It also creates a lock here while running:

```text
~/.codex/tmp/provider-sync.lock
```

If you see a lock error:

- close Codex and related apps
- verify no sync is already running
- retry

## FAQ

### Will this modify my conversations?

No. It only changes provider metadata used for session discovery.

It does not rewrite:

- thread IDs
- message history
- titles
- cwd
- timestamps

### Does this replace the official `codex` command?

No. You continue using official Codex exactly as before.

This tool only fixes historical provider metadata so official Codex can see those sessions again.

### Does it work with Codex App / app-server style session lists?

If the client is using the same standard `.codex` session storage, syncing both rollout files and SQLite is the key step that makes those sessions visible again.

### Does `switch` also log me into the provider?

No.

`switch` only:

- updates root-level `model_provider` in `config.toml`
- syncs history to that provider

You still handle auth separately if your provider requires it.

### What does `state_5.sqlite is currently in use` mean?

It means official Codex, Codex App, or another process still has the SQLite state database open.

Close Codex, close the Codex App or app-server process, then run `sync` or `restore` again.

### What if a rollout file is locked by the current session?

`sync` skips locked rollout files and continues updating the rest of the history plus SQLite.

You will see the skipped file paths in the command output. Rerun `sync` later after closing the current session if you want those files rewritten too.

### What if my custom provider is not accepted?

`switch <provider-id>` validates that the provider exists in `config.toml`, except for built-in `openai`.

If the provider is missing:

1. add it to `config.toml`
2. or switch it via your existing tool
3. then run `codex-provider sync`

## Development

```bash
git clone https://github.com/Dailin521/codex-provider-sync.git
cd codex-provider-sync
npm test
node ./src/cli.js status --codex-home C:\path\to\.codex
```

Current implementation notes:

- Node.js only
- uses built-in `node:sqlite`
- tested on Windows first

## License

MIT
