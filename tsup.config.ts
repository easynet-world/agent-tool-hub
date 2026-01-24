import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/toolhub-runtime.ts"],
  format: ["esm", "cjs"],
  dts: true,
  splitting: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  target: "node18",
  outDir: "dist",
});
