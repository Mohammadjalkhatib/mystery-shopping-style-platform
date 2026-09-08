import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { AuthUser } from '@msp/shared';
import type { Model } from 'mongoose';
import type { Readable } from 'node:stream';
import { Report } from '../db/schemas/report-verification.schema.js';
import { Session } from '../db/schemas/task-session.schema.js';
import {
  ALLOWED_EVIDENCE_TYPES,
  looksLikeType,
  MAX_EVIDENCE_BYTES,
  type EvidenceContentType,
} from './evidence.constants.js';
import { OBJECT_STORE, type ObjectStore } from './storage/object-store.js';

export interface StoredEvidence {
  evidenceKey: string;
  bytes: number;
  contentType: EvidenceContentType;
}

export interface EvidenceStream {
  stream: Readable;
  contentType: string;
  bytes: number;
}

/**
 * The single photo a participant may attach to a report.
 *
 * **Stored in GridFS, not S3, and that is a deliberate reversal of a documented plan (D-026).**
 * The code still talks to one narrow interface, so an S3 adapter replaces this file without
 * touching a caller -- but the demo works today, on the free tier, with no credentials and no
 * vendor SDK.
 *
 * Ownership is the whole security story here. An uploaded object is tagged with the session it
 * was uploaded for, and every read re-derives who may see it from that tag. There is no code
 * path where a caller names an object and is trusted about which visit it belongs to.
 */
@Injectable()
export class EvidenceService {
  constructor(
    @Inject(OBJECT_STORE) private readonly objects: ObjectStore,
    @InjectModel(Session.name) private readonly sessions: Model<Session>,
    @InjectModel(Report.name) private readonly reports: Model<Report>,
  ) {}

  /** Which backend is live. Surfaced so "where are the photos" is never a guess. */
  get backend(): string {
    return this.objects.kind;
  }

  /**
   * Store one image against one active session.
   *
   * The body IS buffered -- GridFS wants a complete object, and the magic-byte check needs the
   * head before anything is written -- but the buffer stops growing the moment the cap is
   * passed and the rest of the request is read and discarded. Peak memory is therefore bounded
   * by MAX_EVIDENCE_BYTES per upload rather than by whatever the client chose to send.
   *
   * The remainder is drained rather than the socket destroyed: killing the stream mid-request
   * makes the client see a connection reset instead of the 413 that explains what happened.
   */
  async store(
    sessionId: string,
    user: AuthUser,
    contentType: string,
    body: Readable,
  ): Promise<StoredEvidence> {
    if (!ALLOWED_EVIDENCE_TYPES.includes(contentType as EvidenceContentType)) {
      throw new BadRequestException(
        `Content-Type must be one of ${ALLOWED_EVIDENCE_TYPES.join(', ')}`,
      );
    }
    const type = contentType as EvidenceContentType;

    const session = await this.sessions
      .findById(sessionId)
      .select({ participantId: 1, clientOrgId: 1, state: 1 })
      .lean<{ participantId: string; clientOrgId: string; state: string } | null>();
    if (!session) throw new NotFoundException('Session not found');
    if (session.participantId !== user.id) {
      throw new ForbiddenException('This session belongs to another participant');
    }
    /**
     * Only while the visit is running or just ended.
     *
     * Same reasoning as ping ingest (D-010): once a report is submitted the evidence set is
     * part of a record the console has already read and the evaluator has already scored, and
     * a late attachment would change what a verdict was about after the fact.
     */
    if (session.state !== 'active' && session.state !== 'ended') {
      throw new BadRequestException(
        `Evidence can only be attached while a visit is active or ended; this one is ${session.state}.`,
      );
    }

    const chunks: Buffer[] = [];
    let bytes = 0;
    let overflowed = false;
    for await (const chunk of body) {
      const buf = chunk as Buffer;
      bytes += buf.length;
      if (bytes > MAX_EVIDENCE_BYTES) {
        // Stop accumulating, keep reading. Memory stays capped and the response still sends.
        overflowed = true;
        chunks.length = 0;
        continue;
      }
      if (!overflowed) chunks.push(buf);
    }
    if (overflowed) {
      throw new PayloadTooLargeException(
        `Evidence must be under ${Math.floor(MAX_EVIDENCE_BYTES / (1024 * 1024))} MB`,
      );
    }
    if (bytes === 0) throw new BadRequestException('Empty body');

    const data = Buffer.concat(chunks);
    /**
     * The declared type is checked against the actual bytes (rule 2).
     *
     * Without this, `Content-Type: image/png` with an HTML body is stored and later served
     * back, and the only thing between that and a stored XSS is a response header.
     */
    if (!looksLikeType(data.subarray(0, 16), type)) {
      throw new BadRequestException(`That file is not a valid ${type}`);
    }

    /**
     * One photo per session: the previous one is DELETED, not orphaned.
     *
     * `Report.evidenceKey` is a single scalar, so the data model has only ever described one
     * photo. Without this, every re-pick in the UI writes another object that nothing will ever
     * reference or remove -- and on a 512 MB Atlas M0 that is a genuine exhaustion path, since
     * evidence never expires while pings do. What breaks first is not this endpoint: Atlas
     * refuses writes DATABASE-WIDE, so the first symptom is ping ingest failing, three layers
     * away from the cause. Found by the schema-reviewer pass.
     */
    await this.deleteForSession(sessionId);

    const stored = await this.objects.put(data, {
      contentType: type,
      sessionId,
      participantId: session.participantId,
      clientOrgId: session.clientOrgId,
    });

    return { evidenceKey: stored.key, bytes: stored.bytes, contentType: type };
  }

  /**
   * Delete every stored photo for a session, optionally keeping one.
   *
   * Called on re-upload (keep nothing) and after a report commits (keep the referenced one).
   * `bucket.delete()` rather than a raw delete on `evidence.files`, because the bytes live in
   * `evidence.chunks` and only the bucket API removes both. A file document deleted on its own
   * leaves the image in the database permanently, and no longer reachable through the GridFS
   * API to be cleaned up properly -- which is also why a TTL index is the wrong tool here.
   */
  async deleteForSession(sessionId: string, keepKey?: string | null): Promise<number> {
    const keys = await this.objects.listBySession(sessionId);
    let deleted = 0;
    for (const key of keys) {
      if (keepKey && key === keepKey) continue;
      await this.objects.delete(key);
      deleted++;
    }
    return deleted;
  }

  /**
   * Confirm an evidence key really belongs to this session.
   *
   * Called by the submit path. The key travels through the client, like `clientPingId` does,
   * so it is an identifier the client may CARRY but never one it is believed about: without
   * this check a participant could attach another visit's photo to their own report by pasting
   * its id.
   */
  async assertBelongsTo(evidenceKey: string, sessionId: string): Promise<void> {
    const meta = await this.objects.head(evidenceKey);
    if (!meta) throw new BadRequestException('That evidence does not exist');
    if (meta.sessionId !== sessionId) {
      throw new ForbiddenException('That evidence belongs to another visit');
    }
  }

  /**
   * Read an image back.
   *
   * A participant may read their own; a business user may read one from their own org; an
   * admin may read any. The org is taken from the object's own metadata, never from a query
   * parameter, which is the same rule the console list obeys.
   */
  async read(evidenceKey: string, user: AuthUser): Promise<EvidenceStream> {
    const found = await this.objects.get(evidenceKey);
    if (!found) throw new NotFoundException('Evidence not found');
    const meta = found.metadata;

    /**
     * Org membership alone is NOT sufficient for a business user.
     *
     * A photo uploaded during a visit the participant then abandoned would otherwise be
     * readable by the client for ever, though it was never submitted to them. The participant's
     * understanding is that the photo becomes the client's when they press submit, so that is
     * the condition enforced. Raised by the schema-reviewer pass.
     */
    let allowed =
      user.role === 'admin' || (user.role === 'participant' && meta.participantId === user.id);
    if (!allowed && user.role === 'business' && meta.clientOrgId === user.clientOrgId) {
      allowed = Boolean(await this.reports.exists({ evidenceKey }));
    }
    if (!allowed) throw new ForbiddenException('You may not view this evidence');

    return { stream: found.stream, contentType: found.contentType, bytes: found.bytes };
  }
}
