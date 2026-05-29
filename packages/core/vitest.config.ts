import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      include: ["src/**/*.ts"],
      // Excluded:
      //  - test files
      //  - barrel re-exports (no logic)
      //  - the types-only barrel
      //  - network-bound files that can't be unit-tested without a live relay or
      //    browser extension:
      //    * blossom/ — BlossomClient hits Blossom HTTP servers
      //    * NostrRuntime / SubscriptionManager — wrap SimplePool over live relays
      //    * OutboxService — write-path orchestration over live relays
      //    * NIP07Signer — delegates entirely to window.nostr browser extension
      //    * DriveSignerAdapter — thin adapter; logic is in signerManager (tested)
      //    Their behavior is verified indirectly via the consumers that DO have tests.
      exclude: [
        "src/**/*.test.ts",
        "src/**/index.ts",
        "src/types.ts",
        "src/blossom/**",
        "src/runtime/NostrRuntime.ts",
        "src/runtime/SubscriptionManager.ts",
        "src/relay/OutboxService.ts",
        "src/signer/NIP07Signer.ts",
        "src/signer/DriveSignerAdapter.ts",
      ],
      thresholds: {
        lines: 85,
        statements: 85,
        functions: 80,
        branches: 75,
      },
    },
  },
});
