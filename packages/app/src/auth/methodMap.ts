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
      return "nip55";
  }
}
