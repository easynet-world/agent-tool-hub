import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SkillAdapter } from "../../src/adapters/SkillAdapter.js";
import type { SkillHandler, SkillInstructionResult } from "../../src/adapters/SkillAdapter.js";
import type { SkillDefinition } from "../../src/discovery/loaders/SkillManifest.js";
import type { ExecContext } from "../../src/types/ToolIntent.js";
import type { ToolSpec } from "../../src/types/ToolSpec.js";

function makeExecContext(overrides?: Partial<ExecContext>): ExecContext {
  return {
    requestId: "req-1",
    taskId: "task-1",
    permissions: [],
    ...overrides,
  };
}

function makeToolSpec(overrides?: Partial<ToolSpec>): ToolSpec {
  return {
    name: "test-skill",
    version: "1.0.0",
    kind: "skill",
    inputSchema: { type: "object" },
    outputSchema: { type: "object" },
    capabilities: [],
    ...overrides,
  };
}

describe("SkillAdapter", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "skill-adapter-test-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function makeDefinition(overrides?: Partial<SkillDefinition>): SkillDefinition {
    return {
      frontmatter: {
        name: "test-skill",
        description: "A test skill for unit tests",
      },
      instructions: "# Test Skill\n\nDo the thing.",
      resources: [],
      dirPath: dir,
      skillMdPath: join(dir, "SKILL.md"),
      ...overrides,
    };
  }

  describe("registerSkill / unregisterSkill", () => {
    it("registers and lists a skill", async () => {
      const adapter = new SkillAdapter();
      adapter.registerSkill("my-skill", makeDefinition());

      const tools = await adapter.listTools();
      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe("my-skill");
      expect(tools[0].description).toBe("A test skill for unit tests");
    });

    it("unregisters a skill", async () => {
      const adapter = new SkillAdapter();
      adapter.registerSkill("my-skill", makeDefinition());
      expect(adapter.unregisterSkill("my-skill")).toBe(true);

      const tools = await adapter.listTools();
      expect(tools).toHaveLength(0);
    });
  });

  describe("getMetadata (Level 1)", () => {
    it("returns name and description for all registered skills", () => {
      const adapter = new SkillAdapter();
      adapter.registerSkill("skill-a", makeDefinition({
        frontmatter: { name: "skill-a", description: "First skill" },
      }));
      adapter.registerSkill("skill-b", makeDefinition({
        frontmatter: { name: "skill-b", description: "Second skill" },
      }));

      const metadata = adapter.getMetadata();
      expect(metadata).toHaveLength(2);
      expect(metadata[0]).toEqual({ name: "skill-a", description: "First skill" });
      expect(metadata[1]).toEqual({ name: "skill-b", description: "Second skill" });
    });
  });

  describe("getInstructions (Level 2)", () => {
    it("returns instructions for a registered skill", () => {
      const adapter = new SkillAdapter();
      adapter.registerSkill("my-skill", makeDefinition({
        instructions: "# Step 1\n\nDo this first.",
      }));

      expect(adapter.getInstructions("my-skill")).toBe("# Step 1\n\nDo this first.");
    });

    it("returns undefined for unknown skill", () => {
      const adapter = new SkillAdapter();
      expect(adapter.getInstructions("unknown")).toBeUndefined();
    });
  });

  describe("getResources (Level 3)", () => {
    it("returns resources for a registered skill", () => {
      const adapter = new SkillAdapter();
      adapter.registerSkill("my-skill", makeDefinition({
        resources: [
          {
            relativePath: "FORMS.md",
            absolutePath: join(dir, "FORMS.md"),
            extension: ".md",
            type: "instructions",
          },
          {
            relativePath: "scripts/run.py",
            absolutePath: join(dir, "scripts/run.py"),
            extension: ".py",
            type: "code",
          },
        ],
      }));

      const resources = adapter.getResources("my-skill");
      expect(resources).toHaveLength(2);
      expect(resources[0].type).toBe("instructions");
      expect(resources[1].type).toBe("code");
    });

    it("returns empty array for unknown skill", () => {
      const adapter = new SkillAdapter();
      expect(adapter.getResources("unknown")).toEqual([]);
    });
  });

  describe("readResource", () => {
    it("reads a resource file", async () => {
      await writeFile(join(dir, "FORMS.md"), "# Forms\n\nFill forms here.");

      const adapter = new SkillAdapter();
      adapter.registerSkill("my-skill", makeDefinition({
        resources: [
          {
            relativePath: "FORMS.md",
            absolutePath: join(dir, "FORMS.md"),
            extension: ".md",
            type: "instructions",
          },
        ],
      }));

      const content = await adapter.readResource("my-skill", "FORMS.md");
      expect(content).toBe("# Forms\n\nFill forms here.");
    });

    it("throws for unknown skill", async () => {
      const adapter = new SkillAdapter();
      await expect(adapter.readResource("unknown", "file.md")).rejects.toThrow(
        "Skill not found",
      );
    });

    it("throws for unknown resource path", async () => {
      const adapter = new SkillAdapter();
      adapter.registerSkill("my-skill", makeDefinition({ resources: [] }));

      await expect(
        adapter.readResource("my-skill", "missing.md"),
      ).rejects.toThrow("Resource not found");
    });
  });

  describe("invoke — instruction-only mode", () => {
    it("returns skill content when no handler is registered", async () => {
      const adapter = new SkillAdapter();
      const def = makeDefinition({
        resources: [
          {
            relativePath: "REFERENCE.md",
            absolutePath: join(dir, "REFERENCE.md"),
            extension: ".md",
            type: "instructions",
          },
        ],
      });
      adapter.registerSkill("test-skill", def);

      const spec = makeToolSpec();
      const result = await adapter.invoke(spec, {}, makeExecContext());

      const instructionResult = result.result as SkillInstructionResult;
      expect(instructionResult.name).toBe("test-skill");
      expect(instructionResult.description).toBe("A test skill for unit tests");
      expect(instructionResult.instructions).toContain("# Test Skill");
      expect(instructionResult.resources).toHaveLength(1);
      expect(instructionResult.resources[0].path).toBe("REFERENCE.md");
      expect(instructionResult.resources[0].type).toBe("instructions");
      expect(instructionResult.dirPath).toBe(dir);
    });

    it("raw contains mode indicator", async () => {
      const adapter = new SkillAdapter();
      adapter.registerSkill("test-skill", makeDefinition());

      const result = await adapter.invoke(
        makeToolSpec(),
        {},
        makeExecContext(),
      );

      expect((result.raw as any).mode).toBe("instruction-only");
    });
  });

  describe("invoke — handler mode", () => {
    it("executes handler with SkillContext", async () => {
      const handler: SkillHandler = async (args, ctx) => {
        return {
          result: {
            received: args,
            skillName: ctx.skill.name,
            hasInstructions: ctx.skill.instructions.length > 0,
          },
        };
      };

      const adapter = new SkillAdapter();
      adapter.registerSkill("test-skill", makeDefinition(), handler);

      const result = await adapter.invoke(
        makeToolSpec(),
        { foo: "bar" },
        makeExecContext(),
      );

      const output = result.result as any;
      expect(output.received).toEqual({ foo: "bar" });
      expect(output.skillName).toBe("test-skill");
      expect(output.hasInstructions).toBe(true);
    });

    it("handler can read resources via context", async () => {
      await writeFile(join(dir, "data.json"), '{"key": "value"}');

      const handler: SkillHandler = async (_args, ctx) => {
        const content = await ctx.skill.readResource("data.json");
        return { result: JSON.parse(content) };
      };

      const adapter = new SkillAdapter();
      adapter.registerSkill(
        "test-skill",
        makeDefinition({
          resources: [
            {
              relativePath: "data.json",
              absolutePath: join(dir, "data.json"),
              extension: ".json",
              type: "data",
            },
          ],
        }),
        handler,
      );

      const result = await adapter.invoke(
        makeToolSpec(),
        {},
        makeExecContext(),
      );

      expect(result.result).toEqual({ key: "value" });
    });

    it("handler can filter resources by type", async () => {
      const handler: SkillHandler = async (_args, ctx) => {
        const codeResources = ctx.skill.getResourcesByType("code");
        return { result: { codeFiles: codeResources.map((r) => r.relativePath) } };
      };

      const adapter = new SkillAdapter();
      adapter.registerSkill(
        "test-skill",
        makeDefinition({
          resources: [
            { relativePath: "FORMS.md", absolutePath: "", extension: ".md", type: "instructions" },
            { relativePath: "run.py", absolutePath: "", extension: ".py", type: "code" },
            { relativePath: "validate.sh", absolutePath: "", extension: ".sh", type: "code" },
          ],
        }),
        handler,
      );

      const result = await adapter.invoke(
        makeToolSpec(),
        {},
        makeExecContext(),
      );

      expect((result.result as any).codeFiles).toEqual(["run.py", "validate.sh"]);
    });

    it("handler can invoke sub-tools", async () => {
      const handler: SkillHandler = async (args, ctx) => {
        const subResult = await ctx.invokeTool!("calculator", { expression: "2+2" });
        return { result: { subToolResult: subResult } };
      };

      const toolInvoker = async (name: string, args: unknown) => {
        return { computed: 4 };
      };

      const adapter = new SkillAdapter({ toolInvoker });
      adapter.registerSkill("test-skill", makeDefinition(), handler);

      const result = await adapter.invoke(
        makeToolSpec(),
        {},
        makeExecContext(),
      );

      expect((result.result as any).subToolResult).toEqual({ computed: 4 });
    });

    it("returns evidence from handler", async () => {
      const handler: SkillHandler = async () => {
        return {
          result: { done: true },
          evidence: [
            { type: "text", ref: "output", summary: "Completed", createdAt: "2024-01-01" },
          ],
          metadata: { duration: 100 },
        };
      };

      const adapter = new SkillAdapter();
      adapter.registerSkill("test-skill", makeDefinition(), handler);

      const result = await adapter.invoke(
        makeToolSpec(),
        {},
        makeExecContext(),
      );

      expect((result.raw as any).evidence).toHaveLength(1);
      expect((result.raw as any).evidence[0].ref).toBe("output");
      expect((result.raw as any).metadata.duration).toBe(100);
    });

    it("throws when handler returns invalid output", async () => {
      const handler: SkillHandler = async () => {
        return "not an object" as any;
      };

      const adapter = new SkillAdapter();
      adapter.registerSkill("test-skill", makeDefinition(), handler);

      await expect(
        adapter.invoke(makeToolSpec(), {}, makeExecContext()),
      ).rejects.toThrow("must return { result, evidence? }");
    });
  });

  describe("invoke — definition resolution from spec.impl", () => {
    it("resolves SkillDefinition from spec.impl", async () => {
      const adapter = new SkillAdapter();
      const def = makeDefinition();

      const spec = makeToolSpec({
        impl: { ...def, handler: undefined },
      });

      const result = await adapter.invoke(spec, {}, makeExecContext());
      const output = result.result as SkillInstructionResult;
      expect(output.name).toBe("test-skill");
    });

    it("resolves handler from spec.impl.handler", async () => {
      const handler: SkillHandler = async () => ({ result: { ok: true } });
      const adapter = new SkillAdapter();
      const def = makeDefinition();

      const spec = makeToolSpec({
        impl: { ...def, handler },
      });

      const result = await adapter.invoke(spec, {}, makeExecContext());
      expect((result.result as any).ok).toBe(true);
    });
  });

  describe("invoke — error cases", () => {
    it("throws when skill definition is not found", async () => {
      const adapter = new SkillAdapter();
      await expect(
        adapter.invoke(makeToolSpec({ name: "unknown" }), {}, makeExecContext()),
      ).rejects.toThrow("Skill definition not found");
    });
  });
});
