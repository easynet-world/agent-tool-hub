import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DirectoryScanner } from "../../src/discovery/DirectoryScanner.js";
import { createTestRoot, cleanupTestRoot } from "./DirectoryScanner.test-helpers.js";

describe("DirectoryScanner - Skill tools", () => {
  let toolsRoot: string;

  beforeEach(async () => {
    toolsRoot = await createTestRoot();
  });

  afterEach(async () => {
    await cleanupTestRoot(toolsRoot);
  });

  it("discovers Skill tool with SKILL.md and handler", async () => {
    await mkdir(join(toolsRoot, "my-skill"));
    await writeFile(
      join(toolsRoot, "my-skill", "tool.json"),
      JSON.stringify({ kind: "skill" }),
    );
    await writeFile(
      join(toolsRoot, "my-skill", "SKILL.md"),
      `---\nname: my-skill\ndescription: My skill description\n---\n\n# My Skill\n\nDo the thing.\n`,
    );
    await writeFile(
      join(toolsRoot, "my-skill", "handler.js"),
      `export default async function(args, ctx) { return { result: args }; }`,
    );

    const scanner = new DirectoryScanner({ roots: [toolsRoot] });
    const specs = await scanner.scan();

    expect(specs).toHaveLength(1);
    expect(specs[0]!.kind).toBe("skill");
    expect(specs[0]!.name).toBe("my-skill");
    expect(specs[0]!.description).toBe("My skill description");
  });

  it("discovers instruction-only Skill (no handler)", async () => {
    await mkdir(join(toolsRoot, "info-skill"));
    await writeFile(
      join(toolsRoot, "info-skill", "tool.json"),
      JSON.stringify({ kind: "skill" }),
    );
    await writeFile(
      join(toolsRoot, "info-skill", "SKILL.md"),
      `---\nname: info-skill\ndescription: Provides information\n---\n\n# Info\n\nHere is info.\n`,
    );

    const scanner = new DirectoryScanner({ roots: [toolsRoot] });
    const specs = await scanner.scan();

    expect(specs).toHaveLength(1);
    expect(specs[0]!.kind).toBe("skill");
    expect(specs[0]!.name).toBe("info-skill");
  });

  it("reports error when SKILL.md is missing", async () => {
    await mkdir(join(toolsRoot, "bad-skill"));
    await writeFile(
      join(toolsRoot, "bad-skill", "tool.json"),
      JSON.stringify({ kind: "skill" }),
    );

    const errors: Error[] = [];
    const scanner = new DirectoryScanner({
      roots: [toolsRoot],
      onError: (_dir, err) => errors.push(err),
    });
    const specs = await scanner.scan();

    expect(specs).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.message).toContain("SKILL.md");
  });
});
