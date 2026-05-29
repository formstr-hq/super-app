/** Thrown when an operation requires a signer that isn't available. */
export class SignerUnavailableError extends Error {
  readonly code: "no-signer" | "no-modal";
  constructor(code: "no-signer" | "no-modal", message?: string) {
    super(message ?? defaultMessage(code));
    this.name = "SignerUnavailableError";
    this.code = code;
  }
}

function defaultMessage(code: "no-signer" | "no-modal"): string {
  return code === "no-modal"
    ? "No login modal registered. Call signerManager.registerLoginModal() at app startup."
    : "No signer available. Prompt the user to log in.";
}
