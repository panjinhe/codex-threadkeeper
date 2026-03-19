import { execFile } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { SESSION_DIRS } from "./constants.js";

const execFileAsync = promisify(execFile);

function isRolloutFileBusyError(error) {
  const message = `${error?.code ?? ""} ${error?.message ?? ""}`.toLowerCase();
  return message.includes("ebusy")
    || message.includes("resource busy or locked")
    || message.includes("being used by another process")
    || message.includes("currently in use")
    || message.includes("eperm");
}

function wrapRolloutFileBusyError(error, filePath, action) {
  if (!isRolloutFileBusyError(error)) {
    return error;
  }
  return new Error(
    `Unable to ${action} rollout file because it is currently in use. Close Codex and the Codex app, then retry. Locked file: ${filePath}`
  );
}

async function listJsonlFiles(rootDir) {
  const entries = await fsp.readdir(rootDir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listJsonlFiles(fullPath)));
      continue;
    }
    if (entry.isFile() && entry.name.startsWith("rollout-") && entry.name.endsWith(".jsonl")) {
      files.push(fullPath);
    }
  }
  return files;
}

async function readFirstLineRecord(filePath) {
  let handle;
  try {
    handle = await fsp.open(filePath, "r");
    let position = 0;
    let collected = Buffer.alloc(0);
    while (true) {
      const chunk = Buffer.alloc(64 * 1024);
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, position);
      if (bytesRead === 0) {
        break;
      }
      position += bytesRead;
      collected = Buffer.concat([collected, chunk.subarray(0, bytesRead)]);
      const newlineIndex = collected.indexOf(0x0a);
      if (newlineIndex !== -1) {
        const crlf = newlineIndex > 0 && collected[newlineIndex - 1] === 0x0d;
        const lineBuffer = crlf ? collected.subarray(0, newlineIndex - 1) : collected.subarray(0, newlineIndex);
        return {
          firstLine: lineBuffer.toString("utf8"),
          separator: crlf ? "\r\n" : "\n",
          offset: newlineIndex + 1
        };
      }
    }
    return {
      firstLine: collected.toString("utf8"),
      separator: "",
      offset: collected.length
    };
  } catch (error) {
    throw wrapRolloutFileBusyError(error, filePath, "read");
  } finally {
    await handle?.close();
  }
}

function parseSessionMetaRecord(firstLine) {
  if (!firstLine) {
    return null;
  }
  try {
    const parsed = JSON.parse(firstLine);
    if (parsed?.type !== "session_meta" || typeof parsed?.payload !== "object" || parsed.payload === null) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

async function rewriteFirstLine(filePath, nextFirstLine, separator) {
  const current = await readFirstLineRecord(filePath);
  const tmpPath = `${filePath}.provider-sync.${process.pid}.${Date.now()}.tmp`;
  const writer = fs.createWriteStream(tmpPath, { encoding: "utf8" });

  try {
    await new Promise((resolve, reject) => {
      writer.on("error", reject);
      writer.write(nextFirstLine);
      if (separator) {
        writer.write(separator);
      }

      const headerOnly =
        current.separator === "" &&
        current.offset === Buffer.byteLength(current.firstLine, "utf8");

      if (headerOnly) {
        writer.end();
        writer.once("finish", resolve);
        return;
      }

      const reader = fs.createReadStream(filePath, { start: current.offset });
      reader.on("error", reject);
      reader.on("end", () => writer.end());
      writer.once("finish", resolve);
      reader.pipe(writer, { end: false });
    });

    await fsp.rename(tmpPath, filePath);
  } catch (error) {
    await fsp.rm(tmpPath, { force: true });
    throw wrapRolloutFileBusyError(error, filePath, "rewrite");
  }
}

async function findLockedFilesOnWindows(filePaths) {
  if (!filePaths.length) {
    return [];
  }
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "codex-provider-locks-"));
  const manifestPath = path.join(tempDir, "paths.json");
  const script = `
& {
  param([string]$manifestPath)
  $paths = Get-Content -Raw -Path $manifestPath | ConvertFrom-Json
  foreach ($path in $paths) {
    try {
      $stream = [System.IO.File]::Open($path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
      $stream.Close()
    } catch {
      Write-Output $path
    }
  }
}
`.trim();

  try {
    await fsp.writeFile(manifestPath, JSON.stringify(filePaths), "utf8");
    const { stdout } = await execFileAsync("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      script,
      manifestPath
    ]);
    return stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  } catch (error) {
    throw new Error(`Unable to verify rollout file locks on Windows. ${error.message}`);
  } finally {
    await fsp.rm(tempDir, { recursive: true, force: true });
  }
}

export async function collectSessionChanges(codexHome, targetProvider, options = {}) {
  const {
    skipLockedReads = false
  } = options;
  const summaries = [];
  const lockedPaths = [];
  const providerCounts = {
    sessions: new Map(),
    archived_sessions: new Map()
  };

  for (const dirName of SESSION_DIRS) {
    const rootDir = path.join(codexHome, dirName);
    try {
      await fsp.access(rootDir);
    } catch {
      continue;
    }
    const rolloutPaths = await listJsonlFiles(rootDir);
    for (const rolloutPath of rolloutPaths) {
      let record;
      try {
        record = await readFirstLineRecord(rolloutPath);
      } catch (error) {
        if (skipLockedReads && isRolloutFileBusyError(error)) {
          lockedPaths.push(rolloutPath);
          continue;
        }
        throw error;
      }
      const parsed = parseSessionMetaRecord(record.firstLine);
      if (!parsed) {
        continue;
      }
      const currentProvider = parsed.payload.model_provider ?? "(missing)";
      providerCounts[dirName].set(currentProvider, (providerCounts[dirName].get(currentProvider) ?? 0) + 1);

      if (targetProvider !== "__status_only__" && parsed.payload.model_provider !== targetProvider) {
        parsed.payload.model_provider = targetProvider;
        summaries.push({
          path: rolloutPath,
          threadId: parsed.payload.id ?? null,
          directory: dirName,
          originalFirstLine: record.firstLine,
          originalSeparator: record.separator,
          updatedFirstLine: JSON.stringify(parsed)
        });
      }
    }
  }

  return { changes: summaries, lockedPaths, providerCounts };
}

export async function applySessionChanges(changes) {
  for (const change of changes) {
    await rewriteFirstLine(change.path, change.updatedFirstLine, change.originalSeparator);
  }
}

export async function assertSessionFilesWritable(changes) {
  if (!changes?.length || process.platform !== "win32") {
    return;
  }

  const lockedPaths = await findLockedFilesOnWindows(changes.map((change) => change.path));
  if (lockedPaths.length === 0) {
    return;
  }

  const preview = lockedPaths.slice(0, 5).join(", ");
  const extraCount = lockedPaths.length - Math.min(lockedPaths.length, 5);
  const suffix = extraCount > 0 ? ` (+${extraCount} more)` : "";
  throw new Error(
    `Unable to rewrite rollout files because ${lockedPaths.length} file(s) are currently in use. Close Codex and the Codex app, then retry. Locked file(s): ${preview}${suffix}`
  );
}

export async function splitLockedSessionChanges(changes) {
  if (!changes?.length || process.platform !== "win32") {
    return {
      writableChanges: changes ?? [],
      lockedChanges: []
    };
  }

  const lockedPaths = new Set(await findLockedFilesOnWindows(changes.map((change) => change.path)));
  if (lockedPaths.size === 0) {
    return {
      writableChanges: changes,
      lockedChanges: []
    };
  }

  const writableChanges = [];
  const lockedChanges = [];
  for (const change of changes) {
    if (lockedPaths.has(change.path)) {
      lockedChanges.push(change);
    } else {
      writableChanges.push(change);
    }
  }

  return {
    writableChanges,
    lockedChanges
  };
}

export async function restoreSessionChanges(manifestEntries) {
  for (const entry of manifestEntries) {
    await rewriteFirstLine(entry.path, entry.originalFirstLine, entry.originalSeparator ?? "\n");
  }
}

export function summarizeProviderCounts(providerCounts) {
  const result = {};
  for (const [scope, counts] of Object.entries(providerCounts)) {
    result[scope] = Object.fromEntries([...counts.entries()].sort(([left], [right]) => left.localeCompare(right)));
  }
  return result;
}
