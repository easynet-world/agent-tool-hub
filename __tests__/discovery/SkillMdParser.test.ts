import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseSkillMd,
  scanSkillResources,
  loadSkillDefinition,
} from "../../src/discovery/loaders/SkillMdParser.js";
import {
  validateFrontmatter,
  SkillManifestError,
} from "../../src/discovery/loaders/SkillManifest.js";

describe("parseSkillMd", () => {
  it("parses valid SKILL.md with frontmatter and body", () => {
    const content = `---
name: my-skill
description: Does something useful. Use when processing data.
---

# My Skill

## Instructions

Do the thing.
`;

    const result = parseSkillMd(content, "/test/SKILL.md");
    expect(result.frontmatter.name).toBe("my-skill");
    expect(result.frontmatter.description).toBe(
      "Does something useful. Use when processing data.",
    );
    expect(result.instructions).toContain("# My Skill");
    expect(result.instructions).toContain("Do the thing.");
  });

  it("handles quoted strings in frontmatter", () => {
    const content = `---
name: "quoted-name"
description: 'Single quoted description'
---

Body here.
`;

    const result = parseSkillMd(content, "/test/SKILL.md");
    expect(result.frontmatter.name).toBe("quoted-name");
    expect(result.frontmatter.description).toBe("Single quoted description");
  });

  it("handles multiline description with literal block", () => {
    const content = `---
name: multi-line
description: |
  First line of description.
  Second line of description.
---

Body.
`;

    const result = parseSkillMd(content, "/test/SKILL.md");
    expect(result.frontmatter.name).toBe("multi-line");
    expect(result.frontmatter.description).toContain("First line");
    expect(result.frontmatter.description).toContain("Second line");
  });

  it("throws when frontmatter is missing", () => {
    const content = `# No Frontmatter\n\nJust a markdown file.`;
    expect(() => parseSkillMd(content, "/test/SKILL.md")).toThrow(
      SkillManifestError,
    );
  });

  it("throws when frontmatter is not closed", () => {
    const content = `---\nname: unclosed\ndescription: oops\n\nBody without closing.`;
    expect(() => parseSkillMd(content, "/test/SKILL.md")).toThrow(
      "not closed",
    );
  });

  it("throws when name is missing", () => {
    const content = `---\ndescription: Has description\n---\n\nBody.`;
    expect(() => parseSkillMd(content, "/test/SKILL.md")).toThrow(
      "name is required",
    );
  });

  it("throws when description is missing", () => {
    const content = `---\nname: no-desc\n---\n\nBody.`;
    expect(() => parseSkillMd(content, "/test/SKILL.md")).toThrow(
      "description is required",
    );
  });

  it("returns empty instructions when body is empty", () => {
    const content = `---\nname: empty-body\ndescription: No body\n---\n`;
    const result = parseSkillMd(content, "/test/SKILL.md");
    expect(result.instructions).toBe("");
  });

  it("preserves code blocks in instructions", () => {
    const content = `---
name: with-code
description: Has code examples
---

## Example

\`\`\`python
import pdfplumber
with pdfplumber.open("file.pdf") as pdf:
    text = pdf.pages[0].extract_text()
\`\`\`
`;

    const result = parseSkillMd(content, "/test/SKILL.md");
    expect(result.instructions).toContain("```python");
    expect(result.instructions).toContain("pdfplumber");
  });

  it("parses optional frontmatter (license, compatibility, allowed-tools)", () => {
    const content = `---
name: spec-skill
description: Skill with optional fields per Agent Skills spec
license: Apache-2.0
compatibility: Requires git and docker
allowed-tools: Bash(git:*) Read
---

# Body
`;

    const result = parseSkillMd(content, "/test/SKILL.md");
    expect(result.frontmatter.name).toBe("spec-skill");
    expect(result.frontmatter.description).toContain("optional fields");
    expect(result.frontmatter.license).toBe("Apache-2.0");
    expect(result.frontmatter.compatibility).toBe("Requires git and docker");
    expect(result.frontmatter.allowedTools).toBe("Bash(git:*) Read");
  });

  it("parses nested metadata (nested YAML)", () => {
    const content = `---
name: meta-skill
description: Skill with nested metadata
metadata:
  author: Jane Doe
  version: "1.0"
  tags: experimental
---

# Body
`;

    const result = parseSkillMd(content, "/test/SKILL.md");
    expect(result.frontmatter.name).toBe("meta-skill");
    expect(result.frontmatter.metadata).toBeDefined();
    expect(result.frontmatter.metadata).toEqual({
      author: "Jane Doe",
      version: "1.0",
      tags: "experimental",
    });
  });

  it("parses nested metadata with number and boolean values (stringified)", () => {
    const content = `---
name: meta-types
description: Metadata with mixed types
metadata:
  version: 2
  enabled: true
  label: Hello
---

# Body
`;

    const result = parseSkillMd(content, "/test/SKILL.md");
    expect(result.frontmatter.metadata).toEqual({
      version: "2",
      enabled: "true",
      label: "Hello",
    });
  });

  it("omits metadata when not present", () => {
    const content = `---
name: no-meta
description: No metadata field
---

# Body
`;

    const result = parseSkillMd(content, "/test/SKILL.md");
    expect(result.frontmatter.metadata).toBeUndefined();
  });
});

describe("validateFrontmatter", () => {
  it("passes for valid frontmatter", () => {
    expect(() =>
      validateFrontmatter(
        { name: "valid-skill", description: "Does something useful" },
        "/test",
      ),
    ).not.toThrow();
  });

  it("rejects names with uppercase letters", () => {
    expect(() =>
      validateFrontmatter(
        { name: "Invalid", description: "desc" },
        "/test",
      ),
    ).toThrow("lowercase");
  });

  it("rejects names with spaces", () => {
    expect(() =>
      validateFrontmatter(
        { name: "has space", description: "desc" },
        "/test",
      ),
    ).toThrow("lowercase");
  });

  it("rejects names longer than 64 characters", () => {
    const longName = "a".repeat(65);
    expect(() =>
      validateFrontmatter({ name: longName, description: "desc" }, "/test"),
    ).toThrow("at most 64");
  });

  it("rejects names containing 'anthropic'", () => {
    expect(() =>
      validateFrontmatter(
        { name: "my-anthropic-tool", description: "desc" },
        "/test",
      ),
    ).toThrow("reserved word");
  });

  it("rejects names that start or end with hyphen", () => {
    expect(() =>
      validateFrontmatter(
        { name: "-pdf-processing", description: "desc" },
        "/test",
      ),
    ).toThrow("must not start or end");
    expect(() =>
      validateFrontmatter(
        { name: "pdf-processing-", description: "desc" },
        "/test",
      ),
    ).toThrow("must not start or end");
  });

  it("rejects names with consecutive hyphens", () => {
    expect(() =>
      validateFrontmatter(
        { name: "pdf--processing", description: "desc" },
        "/test",
      ),
    ).toThrow("consecutive hyphens");
  });

  it("rejects compatibility longer than 500 characters", () => {
    const long = "x".repeat(501);
    expect(() =>
      validateFrontmatter(
        { name: "valid", description: "desc", compatibility: long },
        "/test",
      ),
    ).toThrow("compatibility must be at most 500");
  });

  it("rejects names containing 'claude'", () => {
    expect(() =>
      validateFrontmatter(
        { name: "claude-helper", description: "desc" },
        "/test",
      ),
    ).toThrow("reserved word");
  });

  it("rejects names with XML tags", () => {
    expect(() =>
      validateFrontmatter(
        { name: "<script>", description: "desc" },
        "/test",
      ),
    ).toThrow("lowercase");
  });

  it("rejects descriptions longer than 1024 characters", () => {
    const longDesc = "a".repeat(1025);
    expect(() =>
      validateFrontmatter({ name: "valid", description: longDesc }, "/test"),
    ).toThrow("at most 1024");
  });

  it("rejects descriptions with XML tags", () => {
    expect(() =>
      validateFrontmatter(
        { name: "valid", description: "Has <script>alert</script> tag" },
        "/test",
      ),
    ).toThrow("XML tags");
  });

  it("rejects empty description", () => {
    expect(() =>
      validateFrontmatter({ name: "valid", description: "" }, "/test"),
    ).toThrow("required");
  });
});

describe("scanSkillResources", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "skill-resources-test-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("finds markdown files as instructions type", async () => {
    await writeFile(join(dir, "SKILL.md"), "---\nname: x\ndescription: y\n---\n");
    await writeFile(join(dir, "FORMS.md"), "# Forms guide");

    const resources = await scanSkillResources(dir);
    const forms = resources.find((r) => r.relativePath === "FORMS.md");
    expect(forms).toBeDefined();
    expect(forms!.type).toBe("instructions");
    expect(forms!.extension).toBe(".md");
  });

  it("finds Python files as code type", async () => {
    await mkdir(join(dir, "scripts"));
    await writeFile(join(dir, "scripts", "analyze.py"), "print('hello')");

    const resources = await scanSkillResources(dir);
    const script = resources.find((r) => r.relativePath === "scripts/analyze.py");
    expect(script).toBeDefined();
    expect(script!.type).toBe("code");
  });

  it("finds JSON files as data type", async () => {
    await writeFile(join(dir, "schema.json"), '{"key": "value"}');

    const resources = await scanSkillResources(dir);
    const data = resources.find((r) => r.relativePath === "schema.json");
    expect(data).toBeDefined();
    expect(data!.type).toBe("data");
  });

  it("excludes SKILL.md itself", async () => {
    await writeFile(join(dir, "SKILL.md"), "---\nname: x\ndescription: y\n---\n");
    await writeFile(join(dir, "other.md"), "content");

    const resources = await scanSkillResources(dir);
    expect(resources.find((r) => r.relativePath === "SKILL.md")).toBeUndefined();
    expect(resources.find((r) => r.relativePath === "other.md")).toBeDefined();
  });

  it("excludes tool.json", async () => {
    await writeFile(join(dir, "tool.json"), '{"kind": "skill"}');

    const resources = await scanSkillResources(dir);
    expect(resources.find((r) => r.relativePath === "tool.json")).toBeUndefined();
  });

  it("excludes hidden directories", async () => {
    await mkdir(join(dir, ".hidden"));
    await writeFile(join(dir, ".hidden", "secret.txt"), "secret");

    const resources = await scanSkillResources(dir);
    expect(resources).toHaveLength(0);
  });

  it("excludes node_modules", async () => {
    await mkdir(join(dir, "node_modules"));
    await writeFile(join(dir, "node_modules", "pkg.js"), "module");

    const resources = await scanSkillResources(dir);
    expect(resources).toHaveLength(0);
  });

  it("scans subdirectories recursively", async () => {
    await mkdir(join(dir, "reference"));
    await writeFile(join(dir, "reference", "finance.md"), "# Finance");
    await writeFile(join(dir, "reference", "sales.md"), "# Sales");

    const resources = await scanSkillResources(dir);
    expect(resources).toHaveLength(2);
    expect(resources.find((r) => r.relativePath === "reference/finance.md")).toBeDefined();
    expect(resources.find((r) => r.relativePath === "reference/sales.md")).toBeDefined();
  });
});

describe("loadSkillDefinition", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "skill-def-test-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("loads a complete skill definition", async () => {
    await writeFile(
      join(dir, "SKILL.md"),
      `---
name: test-skill
description: A test skill for validation
---

# Test Skill

## Instructions

Do the test thing.
`,
    );
    await mkdir(join(dir, "scripts"));
    await writeFile(join(dir, "scripts", "run.py"), "print('run')");
    await writeFile(join(dir, "REFERENCE.md"), "# Reference");

    const def = await loadSkillDefinition(dir);

    expect(def.frontmatter.name).toBe("test-skill");
    expect(def.frontmatter.description).toBe("A test skill for validation");
    expect(def.instructions).toContain("# Test Skill");
    expect(def.instructions).toContain("Do the test thing.");
    expect(def.dirPath).toBe(dir);
    expect(def.skillMdPath).toBe(join(dir, "SKILL.md"));
    expect(def.resources).toHaveLength(2);

    const script = def.resources.find((r) => r.relativePath === "scripts/run.py");
    expect(script).toBeDefined();
    expect(script!.type).toBe("code");

    const ref = def.resources.find((r) => r.relativePath === "REFERENCE.md");
    expect(ref).toBeDefined();
    expect(ref!.type).toBe("instructions");
  });

  it("throws when SKILL.md is missing", async () => {
    await expect(loadSkillDefinition(dir)).rejects.toThrow("Cannot read SKILL.md");
  });

  it("throws when SKILL.md has invalid frontmatter", async () => {
    await writeFile(join(dir, "SKILL.md"), "# No frontmatter");
    await expect(loadSkillDefinition(dir)).rejects.toThrow(SkillManifestError);
  });
});
