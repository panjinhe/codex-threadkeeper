import { spawn } from "node:child_process";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { getStatus, runRestore, runSwitch, runSync } from "../src/service.js";

async function makeTempCodexHome() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-provider-sync-"));
  const codexHome = path.join(root, ".codex");
  await fs.mkdir(path.join(codexHome, "sessions", "2026", "03", "19"), { recursive: true });
  await fs.mkdir(path.join(codexHome, "archived_sessions", "2026", "03", "18"), { recursive: true });
  return { root, codexHome };
}

async function writeRollout(filePath, id, provider) {
  const payload = {
    id,
    timestamp: "2026-03-19T00:00:00.000Z",
    cwd: "C:\\AITemp",
    source: "cli",
    cli_version: "0.115.0",
    model_provider: provider
  };
  const lines = [
    JSON.stringify({ timestamp: payload.timestamp, type: "session_meta", payload }),
    JSON.stringify({ timestamp: payload.timestamp, type: "event_msg", payload: { type: "user_message", message: "hi" } })
  ];
  await fs.writeFile(filePath, `${lines.join("\n")}\n`, "utf8");
}

async function writeConfig(codexHome, modelProviderLine = "") {
  const config = `${modelProviderLine}${modelProviderLine ? "\n" : ""}sandbox_mode = "danger-full-access"\n\n[model_providers.apigather]\nbase_url = "https://example.com"\n`;
  await fs.writeFile(path.join(codexHome, "config.toml"), config, "utf8");
}

async function writeStateDb(codexHome, rows) {
  const dbPath = path.join(codexHome, "state_5.sqlite");
  const db = new DatabaseSync(dbPath);
  try {
    db.exec(`
      CREATE TABLE threads (
        id TEXT PRIMARY KEY,
        model_provider TEXT,
        archived INTEGER NOT NULL DEFAULT 0,
        first_user_message TEXT NOT NULL DEFAULT ''
      )
    `);
    const stmt = db.prepare("INSERT INTO threads (id, model_provider, archived, first_user_message) VALUES (?, ?, ?, ?)");
    for (const row of rows) {
      stmt.run(row.id, row.model_provider, row.archived ? 1 : 0, row.first_user_message ?? "hello");
    }
  } finally {
    db.close();
  }
}

async function lockRolloutFile(filePath) {
  const script = `
& {
  param([string]$path)
  $stream = [System.IO.File]::Open($path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
  try {
    Write-Output 'locked'
    [Console]::Out.Flush()
    Start-Sleep -Seconds 30
  } finally {
    $stream.Close()
  }
}
`.trim();

  const child = spawn("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    script,
    filePath
  ], {
    stdio: ["ignore", "pipe", "pipe"]
  });

  await new Promise((resolve, reject) => {
    let settled = false;
    let stdout = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
      if (!settled && stdout.includes("locked")) {
        settled = true;
        resolve();
      }
    });

    child.once("error", (error) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    });

    child.once("exit", (code, signal) => {
      if (!settled) {
        settled = true;
        reject(new Error(`Failed to acquire rollout file lock. Exit code: ${code ?? "null"}, signal: ${signal ?? "null"}`));
      }
    });
  });

  return child;
}

test("runSync rewrites rollout files and sqlite, then restore reverts both", async () => {
  const { codexHome } = await makeTempCodexHome();
  await writeConfig(codexHome, 'model_provider = "openai"');
  const sessionPath = path.join(codexHome, "sessions", "2026", "03", "19", "rollout-a.jsonl");
  const archivedPath = path.join(codexHome, "archived_sessions", "2026", "03", "18", "rollout-b.jsonl");
  await writeRollout(sessionPath, "thread-a", "apigather");
  await writeRollout(archivedPath, "thread-b", "newapi");
  await writeStateDb(codexHome, [
    { id: "thread-a", model_provider: "apigather", archived: false },
    { id: "thread-b", model_provider: "newapi", archived: true }
  ]);

  const syncResult = await runSync({ codexHome });
  assert.equal(syncResult.targetProvider, "openai");
  assert.equal(syncResult.changedSessionFiles, 2);
  assert.deepEqual(syncResult.skippedLockedRolloutFiles, []);
  assert.equal(syncResult.sqliteRowsUpdated, 2);

  const syncedSession = await fs.readFile(sessionPath, "utf8");
  const syncedArchived = await fs.readFile(archivedPath, "utf8");
  assert.match(syncedSession, /"model_provider":"openai"/);
  assert.match(syncedArchived, /"model_provider":"openai"/);

  const db = new DatabaseSync(path.join(codexHome, "state_5.sqlite"));
  try {
    const providers = db
      .prepare("SELECT id, model_provider FROM threads ORDER BY id")
      .all()
      .map((row) => ({ ...row }));
    assert.deepEqual(providers, [
      { id: "thread-a", model_provider: "openai" },
      { id: "thread-b", model_provider: "openai" }
    ]);
  } finally {
    db.close();
  }

  await runRestore({ codexHome, backupDir: syncResult.backupDir });

  const restoredSession = await fs.readFile(sessionPath, "utf8");
  const restoredArchived = await fs.readFile(archivedPath, "utf8");
  assert.match(restoredSession, /"model_provider":"apigather"/);
  assert.match(restoredArchived, /"model_provider":"newapi"/);
});

test("runSwitch updates config and syncs provider metadata", async () => {
  const { codexHome } = await makeTempCodexHome();
  await writeConfig(codexHome);
  const sessionPath = path.join(codexHome, "sessions", "2026", "03", "19", "rollout-a.jsonl");
  await writeRollout(sessionPath, "thread-a", "openai");
  await writeStateDb(codexHome, [
    { id: "thread-a", model_provider: "openai", archived: false }
  ]);

  const result = await runSwitch({ codexHome, provider: "apigather" });
  assert.equal(result.targetProvider, "apigather");

  const config = await fs.readFile(path.join(codexHome, "config.toml"), "utf8");
  assert.match(config, /^model_provider = "apigather"/m);
  const rollout = await fs.readFile(sessionPath, "utf8");
  assert.match(rollout, /"model_provider":"apigather"/);
});

test("status reports implicit default provider and rollout/sqlite counts", async () => {
  const { codexHome } = await makeTempCodexHome();
  await writeConfig(codexHome);
  const sessionPath = path.join(codexHome, "sessions", "2026", "03", "19", "rollout-a.jsonl");
  const archivedPath = path.join(codexHome, "archived_sessions", "2026", "03", "18", "rollout-b.jsonl");
  await writeRollout(sessionPath, "thread-a", "apigather");
  await writeRollout(archivedPath, "thread-b", "openai");
  await writeStateDb(codexHome, [
    { id: "thread-a", model_provider: "apigather", archived: false },
    { id: "thread-b", model_provider: "openai", archived: true }
  ]);

  const status = await getStatus({ codexHome });
  assert.equal(status.currentProvider, "openai");
  assert.equal(status.currentProviderImplicit, true);
  assert.deepEqual(status.rolloutCounts.sessions, { apigather: 1 });
  assert.deepEqual(status.sqliteCounts.archived_sessions, { openai: 1 });
});

test("runSwitch rejects unknown custom providers", async () => {
  const { codexHome } = await makeTempCodexHome();
  await writeConfig(codexHome);
  await assert.rejects(
    () => runSwitch({ codexHome, provider: "missing" }),
    /Provider "missing" is not available/
  );
});

test("runSync leaves rollout files and sqlite untouched when sqlite is locked", async () => {
  const { codexHome } = await makeTempCodexHome();
  await writeConfig(codexHome, 'model_provider = "openai"');
  const sessionPath = path.join(codexHome, "sessions", "2026", "03", "19", "rollout-a.jsonl");
  await writeRollout(sessionPath, "thread-a", "apigather");
  await writeStateDb(codexHome, [
    { id: "thread-a", model_provider: "apigather", archived: false }
  ]);

  const lockDb = new DatabaseSync(path.join(codexHome, "state_5.sqlite"));
  try {
    lockDb.exec("BEGIN IMMEDIATE");
    await assert.rejects(
      () => runSync({ codexHome, sqliteBusyTimeoutMs: 0 }),
      /state_5\.sqlite is currently in use/
    );
  } finally {
    try {
      lockDb.exec("ROLLBACK");
    } catch {
      // Ignore cleanup failures in tests.
    }
    lockDb.close();
  }

  const rollout = await fs.readFile(sessionPath, "utf8");
  assert.match(rollout, /"model_provider":"apigather"/);

  const db = new DatabaseSync(path.join(codexHome, "state_5.sqlite"));
  try {
    const row = db
      .prepare("SELECT model_provider FROM threads WHERE id = ?")
      .get("thread-a");
    assert.equal(row.model_provider, "apigather");
  } finally {
    db.close();
  }
});

test("runSync skips locked rollout files and still updates sqlite", async () => {
  if (process.platform !== "win32") {
    return;
  }

  const { codexHome } = await makeTempCodexHome();
  await writeConfig(codexHome, 'model_provider = "openai"');
  const sessionPath = path.join(codexHome, "sessions", "2026", "03", "19", "rollout-a.jsonl");
  await writeRollout(sessionPath, "thread-a", "apigather");
  await writeStateDb(codexHome, [
    { id: "thread-a", model_provider: "apigather", archived: false }
  ]);

  const lockProcess = await lockRolloutFile(sessionPath);
  let result;
  try {
    result = await runSync({ codexHome, sqliteBusyTimeoutMs: 0 });
  } finally {
    lockProcess.kill();
    await new Promise((resolve) => lockProcess.once("exit", resolve));
  }

  assert.equal(result.changedSessionFiles, 0);
  assert.equal(result.sqliteRowsUpdated, 1);
  assert.deepEqual(result.skippedLockedRolloutFiles, [sessionPath]);

  const rollout = await fs.readFile(sessionPath, "utf8");
  assert.match(rollout, /"model_provider":"apigather"/);

  const db = new DatabaseSync(path.join(codexHome, "state_5.sqlite"));
  try {
    const row = db
      .prepare("SELECT model_provider FROM threads WHERE id = ?")
      .get("thread-a");
    assert.equal(row.model_provider, "openai");
  } finally {
    db.close();
  }
});
