#!/usr/bin/env node

import path from "node:path";

import {
  getStatus,
  renderStatus,
  runRestore,
  runSwitch,
  runSync
} from "./service.js";

function printHelp() {
  console.log(`codex-provider

Usage:
  codex-provider status [--codex-home PATH]
  codex-provider sync [--provider ID] [--codex-home PATH]
  codex-provider switch <provider-id> [--codex-home PATH]
  codex-provider restore <backup-dir> [--codex-home PATH]
`);
}

function parseArgs(argv) {
  const positionals = [];
  const flags = {};

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith("--")) {
      positionals.push(value);
      continue;
    }
    const [flagName, inlineValue] = value.split("=", 2);
    const normalizedName = flagName.slice(2);
    if (inlineValue !== undefined) {
      flags[normalizedName] = inlineValue;
      continue;
    }
    const nextValue = argv[index + 1];
    if (nextValue && !nextValue.startsWith("--")) {
      flags[normalizedName] = nextValue;
      index += 1;
    } else {
      flags[normalizedName] = true;
    }
  }

  return { positionals, flags };
}

function summarizeSync(result, label) {
  const lines = [
    `${label} provider: ${result.targetProvider}`,
    `Codex home: ${result.codexHome}`,
    `Backup: ${result.backupDir}`,
    `Updated rollout files: ${result.changedSessionFiles}`,
    `Updated SQLite rows: ${result.sqliteRowsUpdated}${result.sqlitePresent ? "" : " (state_5.sqlite not found)"}`
  ];
  if (result.skippedLockedRolloutFiles?.length) {
    const preview = result.skippedLockedRolloutFiles.slice(0, 5).join(", ");
    const extraCount = result.skippedLockedRolloutFiles.length - Math.min(result.skippedLockedRolloutFiles.length, 5);
    lines.push(`Skipped locked rollout files: ${result.skippedLockedRolloutFiles.length}`);
    lines.push(`Locked file(s): ${preview}${extraCount > 0 ? ` (+${extraCount} more)` : ""}`);
  }
  return lines.join("\n");
}

async function main() {
  const { positionals, flags } = parseArgs(process.argv.slice(2));
  const command = positionals[0];

  if (!command || command === "help" || flags.help) {
    printHelp();
    return;
  }

  if (command === "status") {
    const status = await getStatus({ codexHome: flags["codex-home"] });
    console.log(renderStatus(status));
    return;
  }

  if (command === "sync") {
    const result = await runSync({
      codexHome: flags["codex-home"],
      provider: flags.provider
    });
    console.log(summarizeSync(result, "Synchronized"));
    return;
  }

  if (command === "switch") {
    const provider = positionals[1] ?? flags.provider;
    const result = await runSwitch({
      codexHome: flags["codex-home"],
      provider
    });
    console.log(summarizeSync(result, "Switched to"));
    return;
  }

  if (command === "restore") {
    const backupDir = positionals[1] ?? flags.backup;
    const result = await runRestore({
      codexHome: flags["codex-home"],
      backupDir
    });
    console.log(`Restored backup from ${path.resolve(backupDir)}`);
    console.log(`Codex home: ${result.codexHome}`);
    console.log(`Provider at backup time: ${result.targetProvider}`);
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
