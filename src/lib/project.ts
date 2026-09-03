import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { consola } from "consola";

interface ProjectLink {
  projectId: string;
  orgId?: string;
}

const PROJECT_DIR = ".pgbeam";
const PROJECT_FILE = "project.json";

function projectFilePath(dir: string): string {
  return join(dir, PROJECT_DIR, PROJECT_FILE);
}

/**
 * Load the project link for a directory, walking ancestor directories up to
 * the filesystem root (like git discovers its repository), so commands work
 * from any subdirectory of a linked project.
 */
export function loadProjectLink(cwd: string = process.cwd()): ProjectLink | null {
  let dir = resolve(cwd);
  for (;;) {
    const path = projectFilePath(dir);
    if (existsSync(path)) {
      const raw = readFileSync(path, "utf-8");
      try {
        const parsed: ProjectLink = JSON.parse(raw);
        return parsed;
      } catch {
        consola.warn("Corrupted .pgbeam/project.json. Run `pgbeam link` to re-link.");
        return null;
      }
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function saveProjectLink(link: ProjectLink, cwd?: string): void {
  const path = projectFilePath(cwd ?? process.cwd());
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path, `${JSON.stringify(link, null, 2)}\n`);
}

export function removeProjectLink(cwd?: string): boolean {
  const path = projectFilePath(cwd ?? process.cwd());
  if (!existsSync(path)) return false;
  unlinkSync(path);
  return true;
}
