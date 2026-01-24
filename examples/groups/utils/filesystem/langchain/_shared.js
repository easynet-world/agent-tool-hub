import { readFile, writeFile, readdir, rm } from "node:fs/promises";

export async function readText(path) {
  return readFile(path, "utf-8");
}

export async function writeText(path, content) {
  await writeFile(path, content, "utf-8");
  return JSON.stringify({ ok: true, path });
}

export async function listDir(path) {
  const entries = await readdir(path, { withFileTypes: true });
  const items = entries.map((e) => ({
    name: e.name,
    type: e.isDirectory() ? "directory" : "file",
  }));
  return JSON.stringify(items);
}

export async function deletePath(path) {
  await rm(path, { recursive: true, force: true });
  return JSON.stringify({ ok: true, path });
}
