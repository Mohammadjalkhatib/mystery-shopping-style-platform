import mongoose, { type Connection } from 'mongoose';
import type { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { EVIDENCE_BUCKET } from '../evidence.constants.js';
import type {
  FetchedObject,
  ObjectMetadata,
  ObjectStore,
  StoredObject,
} from './object-store.js';

/**
 * Evidence in MongoDB GridFS. The fallback when no bucket is configured (D-026).
 *
 * This is what the deployed demo runs on, because no S3 credentials exist for it. It is
 * correct and it is bounded: photos share the 512 MB Atlas tier with everything else, which is
 * a demo-grade answer and stated as such in the README.
 */
export class GridFsObjectStore implements ObjectStore {
  readonly kind = 'gridfs' as const;

  private cachedBucket: mongoose.mongo.GridFSBucket | null = null;
  private indexReady: Promise<void> | null = null;

  constructor(private readonly connection: Connection) {}

  /**
   * Memoised. The driver caches "indexes checked" per bucket INSTANCE, so a fresh one on every
   * call re-runs that check and costs a round trip per upload.
   */
  private bucket(): mongoose.mongo.GridFSBucket {
    if (this.cachedBucket) return this.cachedBucket;
    const db = this.connection.db;
    if (!db) throw new Error('No database connection for evidence storage');
    this.cachedBucket = new mongoose.mongo.GridFSBucket(db, { bucketName: EVIDENCE_BUCKET });
    return this.cachedBucket;
  }

  /**
   * `metadata.sessionId` is a real query path, not decoration.
   *
   * The driver's default GridFS indexes cover `_id` and chunk fetch by `files_id` and nothing
   * else. Replace and sweep both query by session, so without this they are collection scans
   * that get slower exactly as storage fills.
   */
  private async ensureIndex(): Promise<void> {
    this.indexReady ??= (async () => {
      const db = this.connection.db;
      if (!db) return;
      await db
        .collection(EVIDENCE_BUCKET + '.files')
        .createIndex({ 'metadata.sessionId': 1 }, { name: 'evidence_by_session' });
    })();
    return this.indexReady;
  }

  async put(data: Buffer, metadata: ObjectMetadata): Promise<StoredObject> {
    await this.ensureIndex();
    const upload = this.bucket().openUploadStream(
      `${metadata.sessionId}-${Date.now()}-${randomUUID()}`,
      {
        // `contentType` was removed from the driver's write options, so it lives in metadata
        // alongside the ownership tags.
        metadata: { ...metadata, uploadedAt: new Date() },
      },
    );
    await new Promise<void>((resolve, reject) => {
      upload.once('error', reject);
      upload.once('finish', () => resolve());
      upload.end(data);
    });
    return { key: String(upload.id), bytes: data.length };
  }

  async get(key: string): Promise<FetchedObject | null> {
    const file = await this.findFile(key);
    if (!file) return null;
    return {
      stream: this.bucket().openDownloadStream(file._id) as unknown as Readable,
      contentType: file.metadata?.contentType ?? 'application/octet-stream',
      bytes: file.length,
      metadata: file.metadata ?? {},
    };
  }

  async head(key: string): Promise<(Partial<ObjectMetadata> & { key: string }) | null> {
    const file = await this.findFile(key);
    return file ? { key, ...(file.metadata ?? {}) } : null;
  }

  async listBySession(sessionId: string): Promise<string[]> {
    await this.ensureIndex();
    const files = await this.bucket().find({ 'metadata.sessionId': sessionId }).toArray();
    return files.map((f) => String(f._id));
  }

  /**
   * `bucket.delete()`, never a raw delete on `evidence.files`.
   *
   * The bytes live in `evidence.chunks` and only the bucket API removes both. A file document
   * deleted alone leaves the image in the database permanently and no longer reachable through
   * the GridFS API to be cleaned up -- which is also why a TTL index is the wrong tool here.
   */
  async delete(key: string): Promise<void> {
    if (!mongoose.Types.ObjectId.isValid(key)) return;
    try {
      await this.bucket().delete(new mongoose.Types.ObjectId(key));
    } catch {
      // Already gone, or a concurrent delete won. Deleting is idempotent by contract.
    }
  }

  /** GridFS is reachable exactly when Mongo is, which /health already reports separately. */
  async verify(): Promise<{ ok: boolean; detail: string }> {
    const db = this.connection.db;
    if (!db) return { ok: false, detail: 'no database connection' };
    await this.ensureIndex();
    return { ok: true, detail: `MongoDB GridFS bucket "${EVIDENCE_BUCKET}"` };
  }

  private async findFile(key: string): Promise<
    | {
        _id: mongoose.Types.ObjectId;
        length: number;
        metadata?: Partial<ObjectMetadata>;
      }
    | null
  > {
    // A malformed id is "not found", not a 500. GridFS keys are ObjectIds.
    if (!mongoose.Types.ObjectId.isValid(key)) return null;
    const [file] = await this.bucket()
      .find({ _id: new mongoose.Types.ObjectId(key) })
      .limit(1)
      .toArray();
    return (file as never) ?? null;
  }
}
