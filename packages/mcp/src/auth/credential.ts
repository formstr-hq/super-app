import { z } from "zod";

/**
 * A stored sign-in. For `local`, we keep the user's nsec (in the OS keychain or an
 * encrypted file — never in chat or host config). For `nip46`, we keep only a *session
 * token*: the ephemeral client key + the remote signer's coordinates. The user's real
 * key stays in their bunker/extension and never enters this process.
 */
export const credentialSchema = z.discriminatedUnion("method", [
  z.object({
    method: z.literal("local"),
    pubkey: z.string(),
    nsec: z.string(),
  }),
  z.object({
    method: z.literal("nip46"),
    pubkey: z.string(),
    clientSecretKey: z.string(),
    remoteSignerPubkey: z.string(),
    relays: z.array(z.string()),
    secret: z.string().optional(),
  }),
]);

export type Credential = z.infer<typeof credentialSchema>;

export function serializeCredential(c: Credential): string {
  return JSON.stringify(c);
}

export function parseCredential(raw: string): Credential {
  return credentialSchema.parse(JSON.parse(raw));
}
