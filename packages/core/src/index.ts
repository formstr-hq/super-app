// @formstr/core — shared infrastructure for the Formstr super-app

// Signer
export {
  SignerManager,
  signerManager,
  LocalSigner,
  NIP07Signer,
  DeferredSigner,
  createDriveSignerAdapter,
  SignerUnavailableError,
} from "./signer";
export type {
  NostrSigner,
  SignerMethod,
  SignerState,
  SignerObserver,
  DriveSignerAdapter,
} from "./signer";

// Runtime
export { NostrRuntime, nostrRuntime, EventStore, SubscriptionManager } from "./runtime";
export type { SubscriptionHandle } from "./runtime";

// Relay
export {
  RelayManager,
  relayManager,
  OutboxService,
  outboxService,
  MODULE_DEFAULT_RELAYS,
} from "./relay";
export type { RelayConfig } from "./relay";

// Blossom
export { BlossomClient, createBlossomAuthEvent } from "./blossom";
export type { BlossomUploadResult } from "./blossom";

// Crypto
export {
  nip44Encrypt,
  nip44Decrypt,
  nip44SelfEncrypt,
  nip44SelfDecrypt,
  createRumor,
  createSeal,
  createWrap,
  wrapEvent,
  wrapManyEvents,
  unwrapEvent,
  encodeNKeys,
  decodeNKeys,
  generateFileKey,
  aesGcmEncrypt,
  aesGcmDecrypt,
} from "./crypto";
export type { EncryptedPayload } from "./crypto";

// Linking
export { createRef, parseRef, resolveRef } from "./linking";
export type { ModuleRef, ModuleType } from "./linking";

// Types
export type {
  NostrEvent,
  SignedEvent,
  ModuleName,
  AsyncResult,
  NaddrParams,
  NeventParams,
  Tag,
  EventAddress,
  UserProfile,
} from "./types";
