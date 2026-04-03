import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  collectSidebarProjectCandidates,
  normalizeWorkspaceRootPath,
  syncSidebarProjects
} from "../src/global-state.js";

test("normalizeWorkspaceRootPath strips extended prefixes and normalizes drive roots", () => {
  assert.equal(normalizeWorkspaceRootPath("\\\\?\\e:\\repo\\nested\\"), "E:\\repo\\nested");
  assert.equal(normalizeWorkspaceRootPath("E:\\repo\\nested\\..\\project"), "E:\\repo\\project");
  assert.equal(normalizeWorkspaceRootPath("E:\\"), "E:\\");
});

test("collectSidebarProjectCandidates deduplicates case-insensitively and skips codex home worktrees", () => {
  const codexHome = "C:\\Users\\Administrator\\.codex";
  assert.deepEqual(
    collectSidebarProjectCandidates([
      "",
      "  ",
      "E:\\Repo",
      "\\\\?\\e:\\repo\\",
      "C:\\Users\\Administrator\\.codex",
      "C:\\Users\\Administrator\\.codex\\worktrees\\1234\\Repo",
      "D:\\snapshot\\.codex\\worktrees\\5678\\Repo",
      "E:\\Another"
    ], codexHome),
    ["E:\\Another", "E:\\Repo"]
  );
});

test("syncSidebarProjects appends only missing projects and preserves unrelated state", async () => {
  const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), "codex-provider-global-state-"));
  const filePath = path.join(codexHome, ".codex-global-state.json");
  await fs.writeFile(filePath, JSON.stringify({
    foo: "bar",
    "electron-saved-workspace-roots": ["E:\\Existing"],
    "project-order": ["E:\\Existing"],
    "active-workspace-roots": ["E:\\Existing"],
    "thread-workspace-root-hints": {
      alpha: "E:\\Repo",
      beta: "E:\\Another"
    }
  }), "utf8");

  const result = await syncSidebarProjects(codexHome, [
    "E:\\Repo",
    "\\\\?\\e:\\repo",
    "E:\\Another",
    "E:\\Ghost"
  ]);

  assert.equal(result.addedCount, 2);
  assert.deepEqual(result.addedProjects, ["E:\\Another", "E:\\Repo"]);

  const nextState = JSON.parse(await fs.readFile(filePath, "utf8"));
  assert.equal(nextState.foo, "bar");
  assert.deepEqual(nextState["electron-saved-workspace-roots"], ["E:\\Existing", "E:\\Another", "E:\\Repo"]);
  assert.deepEqual(nextState["project-order"], ["E:\\Existing", "E:\\Another", "E:\\Repo"]);
  assert.deepEqual(nextState["active-workspace-roots"], ["E:\\Existing"]);
});
