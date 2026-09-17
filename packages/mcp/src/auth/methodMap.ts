import type { SignerMethod } from "@formstr/core";
import type { LoginMethod } from "@formstr/signer";

/**
 * Map a `@formstr/signer` LoginMethod to the core SignerMethod. Only `ncryptsec`
 * and `nip46` are reachable in the headless MCP (no browser extension, no Android
 * signer app); the other arms exist for exhaustiveness.
 */
export function mapMethod(method: LoginMethod): SignerMethod {
  switch (method) {
    case "extension":
      return "nip07";
    case "nip46":
      return "nip46";
    case "ncryptsec":
      return "local";
    case "android":
    // Browser NIP-55 is unreachable in the headless MCP, but it is still a
    // NIP-55 external signer, so it maps like the Capacitor path.
    case "nip55-web":
      return "nip55";
  }
}
