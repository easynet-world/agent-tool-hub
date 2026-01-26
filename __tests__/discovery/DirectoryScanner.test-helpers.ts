import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function createTestRoot(): Promise<string> {
  return await mkdtemp(join(tmpdir(), "scanner-test-"));
}

export async function cleanupTestRoot(root: string): Promise<void> {
  await rm(root, { recursive: true, force: true });
}
