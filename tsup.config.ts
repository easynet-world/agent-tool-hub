import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/llm-export.ts", "src/toolhub-runtime.ts", "src/cli.ts"],
  format: ["esm", "cjs"],
  dts: true,
  splitting: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  target: "node18",
  outDir: "dist",
});
