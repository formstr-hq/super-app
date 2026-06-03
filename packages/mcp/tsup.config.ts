import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs"],
  target: "node20",
  platform: "node",
  bundle: true,
  // Bundle every dependency EXCEPT the native keyring addon (its platform-specific
  // `.node` binaries can't be inlined into a single JS file; npm/npx installs it).
  noExternal: [/^(?!@napi-rs\/keyring)/],
  external: ["@napi-rs/keyring"],
  banner: { js: "#!/usr/bin/env node" },
  dts: false,
  clean: true,
  sourcemap: true,
});
