import type { Readable } from 'node:stream';

/**
 * What evidence storage has to be able to do. Four verbs, nothing else.
 *
 * D-026 stored photos in GridFS because no bucket existed; D-028 adds the S3 implementation
 * this interface was shaped for. Keeping it this narrow is what makes that a config change
 * rather than a rewrite -- and it is why nothing above this line knows whether the bytes are in
 * MongoDB, MinIO or R2.
 */
export interface ObjectMetadata {
  contentType: string;
  sessionId: string;
  participantId: string;
  clientOrgId: string;
}

export interface StoredObject {
  /** Opaque to every caller. GridFS returns an ObjectId; S3 returns the object key. */
  key: string;
  bytes: number;
}

export interface FetchedObject {
  stream: Readable;
  contentType: string;
  bytes: number;
  metadata: Partial<ObjectMetadata>;
}

export interface ObjectStore {
  /** A name for logs and `/health`, so it is never a guess which backend is live. */
  readonly kind: 'gridfs' | 's3';

  put(data: Buffer, metadata: ObjectMetadata): Promise<StoredObject>;

  /** Null rather than throwing when absent: "not found" is a normal answer here. */
  get(key: string): Promise<FetchedObject | null>;

  /** Metadata only. Used for authorization, which must not stream a whole image first. */
  head(key: string): Promise<(Partial<ObjectMetadata> & { key: string }) | null>;

  /** Every object belonging to a session, so replace-and-sweep can work on either backend. */
  listBySession(sessionId: string): Promise<string[]>;

  /** Idempotent: deleting something already gone is a success, not an error. */
  delete(key: string): Promise<void>;

  /**
   * Can this store actually be reached with the credentials it was given?
   *
   * Run once at boot, never per request. Without it, a wrong key or a typo'd endpoint stays
   * invisible until the first participant tries to attach a photo -- which on a deployed demo
   * means finding out from a user rather than from a log line.
   */
  verify(): Promise<{ ok: boolean; detail: string }>;
}

/** DI token. A string token because the concrete class is chosen at runtime from config. */
export const OBJECT_STORE = Symbol('OBJECT_STORE');
