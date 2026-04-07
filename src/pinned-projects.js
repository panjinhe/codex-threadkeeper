import fs from "node:fs/promises";
import path from "node:path";

import { defaultCodexHome, pinnedSidebarProjectsPath } from "./constants.js";
import { normalizeWorkspaceRootPath, workspaceRootKey } from "./global-state.js";

const PINNED_PROJECTS_FILE_VERSION = 1;

function deduplicateProjects(projects) {
  const uniqueProjects = new Map();
  for (const project of projects ?? []) {
    const normalized = normalizeWorkspaceRootPath(project);
    const key = workspaceRootKey(normalized);
    if (!normalized || !key || uniqueProjects.has(key)) {
      continue;
    }
    uniqueProjects.set(key, normalized);
  }
  return [...uniqueProjects.values()];
}

function normalizeCodexHome(codexHome) {
  return path.resolve(codexHome ?? process.env.CODEX_HOME ?? defaultCodexHome());
}

function normalizePinnedProjectInput(projectPath) {
  if (typeof projectPath !== "string" || !projectPath.trim()) {
    throw new Error("Pinned project path must be a non-empty string.");
  }

  const normalized = normalizeWorkspaceRootPath(path.resolve(projectPath.trim()));
  if (!normalized || !path.win32.isAbsolute(normalized)) {
    throw new Error(`Pinned project path must resolve to an absolute path: ${projectPath}`);
  }

  return normalized;
}

export async function readPinnedProjects(codexHome) {
  const normalizedCodexHome = normalizeCodexHome(codexHome);
  const filePath = pinnedSidebarProjectsPath(normalizedCodexHome);
  let text;
  try {
    text = await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      return {
        exists: false,
        filePath,
        projects: []
      };
    }
    throw error;
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new Error(`Invalid ${path.basename(filePath)}: ${error.message}`);
  }

  if (!data || Array.isArray(data) || typeof data !== "object") {
    throw new Error(`Invalid ${path.basename(filePath)}: expected a top-level JSON object.`);
  }

  if (data.version !== PINNED_PROJECTS_FILE_VERSION) {
    throw new Error(
      `Invalid ${path.basename(filePath)}: expected version ${PINNED_PROJECTS_FILE_VERSION}, received ${data.version ?? "(missing)"}.`
    );
  }

  if (!Array.isArray(data.projects)) {
    throw new Error(`Invalid ${path.basename(filePath)}: expected "projects" to be an array.`);
  }

  const projects = data.projects.map((project, index) => {
    if (typeof project !== "string" || !project.trim()) {
      throw new Error(`Invalid ${path.basename(filePath)}: project at index ${index} must be a non-empty string.`);
    }

    const normalized = normalizeWorkspaceRootPath(project);
    if (!normalized || !path.win32.isAbsolute(normalized)) {
      throw new Error(`Invalid ${path.basename(filePath)}: project at index ${index} must be an absolute path.`);
    }

    return normalized;
  });

  return {
    exists: true,
    filePath,
    projects: deduplicateProjects(projects)
  };
}

export async function writePinnedProjects(codexHome, projects) {
  const normalizedCodexHome = normalizeCodexHome(codexHome);
  const filePath = pinnedSidebarProjectsPath(normalizedCodexHome);
  const normalizedProjects = deduplicateProjects(projects);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(
    filePath,
    JSON.stringify(
      {
        version: PINNED_PROJECTS_FILE_VERSION,
        projects: normalizedProjects
      },
      null,
      2
    ),
    "utf8"
  );
  return {
    filePath,
    projects: normalizedProjects
  };
}

export async function pinProject(codexHome, projectPath) {
  const current = await readPinnedProjects(codexHome);
  const normalizedProject = normalizePinnedProjectInput(projectPath);
  const nextProjects = deduplicateProjects([...current.projects, normalizedProject]);
  const added = nextProjects.some((project) => project === normalizedProject)
    && !current.projects.some((project) => project === normalizedProject);

  const result = await writePinnedProjects(codexHome, nextProjects);
  return {
    ...result,
    added,
    project: normalizedProject
  };
}

export async function unpinProject(codexHome, projectPath) {
  const current = await readPinnedProjects(codexHome);
  const normalizedProject = normalizePinnedProjectInput(projectPath);
  const nextProjects = current.projects.filter((project) => workspaceRootKey(project) !== workspaceRootKey(normalizedProject));
  const removed = nextProjects.length !== current.projects.length;

  const result = await writePinnedProjects(codexHome, nextProjects);
  return {
    ...result,
    removed,
    project: normalizedProject
  };
}
