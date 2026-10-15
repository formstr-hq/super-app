import type { SignerMethod } from "@formstr/core";
import type { LoginMethod } from "@formstr/signer";

/** Map a `@formstr/signer` LoginMethod to the core SignerMethod the app/UI uses. */
export function mapMethod(method: LoginMethod): SignerMethod {
  switch (method) {
    case "extension":
      return "nip07";
    case "nip46":
      return "nip46";
    case "ncryptsec":
      return "local";
    case "android":
    // Browser NIP-55 (intents + clipboard) is the same signer class as the
    // Capacitor path from the app's point of view — both are external NIP-55
    // signer apps, so they share the core `nip55` method.
    case "nip55-web":
      return "nip55";
  }
}
