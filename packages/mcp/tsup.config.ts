import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node20",
  platform: "node",
  bundle: true,
  noExternal: ["@formstr/app", "@formstr/core"],
  banner: { js: "#!/usr/bin/env node" },
  dts: false,
  clean: true,
  sourcemap: true,
});
