import fs from "node:fs/promises";
import path from "node:path";

import { DEFAULT_PROVIDER, defaultCodexHome } from "./constants.js";
import {
  configDeclaresProvider,
  listConfiguredProviderIds,
  readConfigText,
  readCurrentProviderFromConfigText,
  setRootProviderInConfigText,
  writeConfigText
} from "./config-file.js";
import { createBackup, restoreBackup } from "./backup.js";
import { acquireLock } from "./locking.js";
import {
  applySessionChanges,
  collectSessionChanges,
  splitLockedSessionChanges,
  summarizeProviderCounts
} from "./session-files.js";
import {
  assertSqliteWritable,
  readSqliteProviderCounts,
  updateSqliteProvider
} from "./sqlite-state.js";

function normalizeCodexHome(explicitCodexHome) {
  return path.resolve(explicitCodexHome ?? process.env.CODEX_HOME ?? defaultCodexHome());
}

async function ensureCodexHome(codexHome) {
  await fs.access(codexHome);
}

function formatCounts(counts) {
  return Object.entries(counts ?? {})
    .map(([provider, count]) => `${provider}: ${count}`)
    .join(", ") || "(none)";
}

export async function getStatus({ codexHome: explicitCodexHome } = {}) {
  const codexHome = normalizeCodexHome(explicitCodexHome);
  await ensureCodexHome(codexHome);
  const configPath = path.join(codexHome, "config.toml");
  const configText = await readConfigText(configPath);
  const current = readCurrentProviderFromConfigText(configText);
  const configuredProviders = listConfiguredProviderIds(configText);
  const { providerCounts } = await collectSessionChanges(codexHome, "__status_only__");
  const sqliteCounts = await readSqliteProviderCounts(codexHome);

  return {
    codexHome,
    currentProvider: current.provider,
    currentProviderImplicit: current.implicit,
    configuredProviders,
    rolloutCounts: summarizeProviderCounts(providerCounts),
    sqliteCounts
  };
}

export function renderStatus(status) {
  const lines = [
    `Codex home: ${status.codexHome}`,
    `Current provider: ${status.currentProvider}${status.currentProviderImplicit ? " (implicit default)" : ""}`,
    `Configured providers: ${status.configuredProviders.join(", ")}`
  ];

  lines.push("");
  lines.push("Rollout files:");
  lines.push(`  sessions: ${formatCounts(status.rolloutCounts.sessions)}`);
  lines.push(`  archived_sessions: ${formatCounts(status.rolloutCounts.archived_sessions)}`);

  lines.push("");
  lines.push("SQLite state:");
  if (!status.sqliteCounts) {
    lines.push("  state_5.sqlite not found");
  } else {
    lines.push(`  sessions: ${formatCounts(status.sqliteCounts.sessions)}`);
    lines.push(`  archived_sessions: ${formatCounts(status.sqliteCounts.archived_sessions)}`);
  }

  return lines.join("\n");
}

export async function runSync({
  codexHome: explicitCodexHome,
  provider,
  configBackupText,
  sqliteBusyTimeoutMs
} = {}) {
  const codexHome = normalizeCodexHome(explicitCodexHome);
  await ensureCodexHome(codexHome);
  const configPath = path.join(codexHome, "config.toml");
  const configText = await readConfigText(configPath);
  const current = readCurrentProviderFromConfigText(configText);
  const targetProvider = provider ?? current.provider ?? DEFAULT_PROVIDER;

  const releaseLock = await acquireLock(codexHome, "sync");
  let backupDir = null;
  try {
    const {
      changes,
      lockedPaths: lockedReadPaths,
      providerCounts
    } = await collectSessionChanges(codexHome, targetProvider, { skipLockedReads: true });
    const {
      writableChanges,
      lockedChanges
    } = await splitLockedSessionChanges(changes);
    const skippedLockedRolloutFiles = [...new Set([
      ...lockedReadPaths,
      ...lockedChanges.map((change) => change.path)
    ])].sort((left, right) => left.localeCompare(right));
    await assertSqliteWritable(codexHome, { busyTimeoutMs: sqliteBusyTimeoutMs });
    backupDir = await createBackup({
      codexHome,
      targetProvider,
      sessionChanges: writableChanges,
      configPath,
      configBackupText
    });

    let sessionRestoreNeeded = false;
    try {
      const sqliteResult = await updateSqliteProvider(
        codexHome,
        targetProvider,
        async () => {
          if (writableChanges.length === 0) {
            return;
          }
          sessionRestoreNeeded = true;
          await applySessionChanges(writableChanges);
        },
        { busyTimeoutMs: sqliteBusyTimeoutMs }
      );
      return {
        codexHome,
        targetProvider,
        previousProvider: current.provider,
        backupDir,
        changedSessionFiles: writableChanges.length,
        skippedLockedRolloutFiles,
        sqliteRowsUpdated: sqliteResult.updatedRows,
        sqlitePresent: sqliteResult.databasePresent,
        rolloutCountsBefore: summarizeProviderCounts(providerCounts)
      };
    } catch (error) {
      if (backupDir && sessionRestoreNeeded) {
        try {
          await restoreBackup(backupDir, codexHome, {
            restoreConfig: false,
            restoreDatabase: false,
            restoreSessions: true
          });
        } catch (restoreError) {
          throw new Error(
            `Failed to restore rollout files after sync error. Original error: ${error.message}. Restore error: ${restoreError.message}`
          );
        }
      }
      throw error;
    }
  } finally {
    await releaseLock();
  }
}

export async function runSwitch({
  codexHome: explicitCodexHome,
  provider
}) {
  if (!provider) {
    throw new Error("Missing provider id. Usage: codex-provider switch <provider-id>");
  }

  const codexHome = normalizeCodexHome(explicitCodexHome);
  await ensureCodexHome(codexHome);
  const configPath = path.join(codexHome, "config.toml");
  const originalConfigText = await readConfigText(configPath);
  if (!configDeclaresProvider(originalConfigText, provider)) {
    throw new Error(`Provider "${provider}" is not available in config.toml. Configure it first or use one of: ${listConfiguredProviderIds(originalConfigText).join(", ")}`);
  }

  const nextConfigText = setRootProviderInConfigText(originalConfigText, provider);
  await writeConfigText(configPath, nextConfigText);

  try {
    const syncResult = await runSync({
      codexHome,
      provider,
      configBackupText: originalConfigText
    });
    return {
      ...syncResult,
      configUpdated: true
    };
  } catch (error) {
    await writeConfigText(configPath, originalConfigText);
    throw error;
  }
}

export async function runRestore({
  codexHome: explicitCodexHome,
  backupDir
}) {
  if (!backupDir) {
    throw new Error("Missing backup path. Usage: codex-provider restore <backup-dir>");
  }
  const codexHome = normalizeCodexHome(explicitCodexHome);
  await ensureCodexHome(codexHome);
  const releaseLock = await acquireLock(codexHome, "restore");
  try {
    return await restoreBackup(path.resolve(backupDir), codexHome);
  } finally {
    await releaseLock();
  }
}
