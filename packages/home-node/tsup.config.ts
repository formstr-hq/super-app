import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs"],
  target: "node20",
  platform: "node",
  bundle: true,
  // Bundle everything (incl. @formstr/core, whose dist uses bundler-style
  // directory imports that plain Node ESM can't resolve).
  noExternal: [/.*/],
  banner: { js: "#!/usr/bin/env node" },
  dts: false,
  clean: true,
  sourcemap: true,
});
