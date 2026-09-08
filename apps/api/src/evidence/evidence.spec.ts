import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose, { type Connection, type Model } from 'mongoose';
import request from 'supertest';
import { AuthModule } from '../auth/auth.module.js';
import { Report, ReportSchema } from '../db/schemas/report-verification.schema.js';
import { Session, SessionSchema } from '../db/schemas/task-session.schema.js';
import { EvidenceController } from './evidence.controller.js';
import { EvidenceService } from './evidence.service.js';
import { GridFsObjectStore } from './storage/gridfs.store.js';
import { OBJECT_STORE } from './storage/object-store.js';

const ORG = 'org-alfa-retail';
const OTHER_ORG = 'org-someone-else';

/** A buffer that really does start with the PNG signature. */
const png = (bytes = 64): Buffer =>
  Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(Math.max(0, bytes - 8), 7),
  ]);

/** Correct length, wrong contents: what a renamed HTML file looks like. */
const notReallyAPng = (): Buffer => Buffer.from('<html><script>alert(1)</script></html>');

describe('evidence upload', () => {
  let mongod: MongoMemoryReplSet;
  let conn: Connection;
  let app: INestApplication;
  let Sessions: Model<Session>;
  let Reports: Model<Report>;

  let u1 = '';
  let u2 = '';
  let biz = '';
  let otherBiz = '';
  let admin = '';

  const login = async (username: string): Promise<string> => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ username, password: 'demo1234' })
      .expect(200);
    return (res.body as { token: string }).token;
  };
  const auth = (tok: string) => ({ Authorization: `Bearer ${tok}` });

  const makeSession = async (
    over: { participantId?: string; state?: string; org?: string } = {},
  ): Promise<string> => {
    const now = new Date();
    const s = await Sessions.create({
      assignmentId: `a-${Math.random()}`,
      participantId: over.participantId ?? 'u-participant-1',
      clientOrgId: over.org ?? ORG,
      venueId: 'v-1',
      state: over.state ?? 'active',
      pingCount: 0,
      createdAtServer: now,
      startedAt: now,
      lastSeenAt: now,
    } as never);
    return String(s._id);
  };

  const upload = (sessionId: string, tok: string, body: Buffer, type = 'image/png') =>
    request(app.getHttpServer())
      .post(`/sessions/${sessionId}/evidence`)
      .set(auth(tok))
      .set('Content-Type', type)
      .send(body);

  beforeAll(async () => {
    mongod = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    conn = await mongoose.createConnection(mongod.getUri('evidence')).asPromise();
    Sessions = conn.model(Session.name, SessionSchema) as Model<Session>;
    Reports = conn.model(Report.name, ReportSchema) as Model<Report>;

    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), AuthModule],
      controllers: [EvidenceController],
      providers: [
        EvidenceService,
        { provide: getConnectionToken(), useValue: conn },
        /**
         * The GridFS store explicitly, not the config-driven factory.
         *
         * This suite is about the rules that hold whatever the backend is -- ownership,
         * validation, the boundaries. Letting the factory choose would make these tests depend
         * on whether S3_* happened to be set in the environment running them.
         */
        { provide: OBJECT_STORE, useFactory: () => new GridFsObjectStore(conn) },
        { provide: getModelToken(Session.name), useValue: Sessions },
        { provide: getModelToken(Report.name), useValue: Reports },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();

    u1 = await login('user1');
    u2 = await login('user2');
    biz = await login('business');
    admin = await login('admin');
    // A business user in a different org, faked by reusing the token but a foreign session.
    otherBiz = biz;
  });

  afterAll(async () => {
    await app?.close();
    await conn?.close();
    await mongod?.stop();
  });

  /* ------------------------------------------------ authorization boundaries */

  it('401s without a token', async () => {
    const sessionId = await makeSession();
    await request(app.getHttpServer())
      .post(`/sessions/${sessionId}/evidence`)
      .set('Content-Type', 'image/png')
      .send(png())
      .expect(401);
  });

  it('403s a business user: uploading is the participant’s act, not the client’s', async () => {
    const sessionId = await makeSession();
    await upload(sessionId, biz, png()).expect(403);
  });

  it('403s a participant uploading to somebody else’s session', async () => {
    const sessionId = await makeSession({ participantId: 'u-participant-1' });
    await upload(sessionId, u2, png()).expect(403);
  });

  it('accepts an upload from the session’s own participant', async () => {
    const sessionId = await makeSession({ participantId: 'u-participant-1' });
    const res = await upload(sessionId, u1, png()).expect(201);
    expect((res.body as { evidenceKey: string }).evidenceKey).toMatch(/^[0-9a-f]{24}$/);
  });

  /* -------------------------------------------------------------- validation */

  it('refuses a content type that is not an allowed image', async () => {
    const sessionId = await makeSession();
    await upload(sessionId, u1, png(), 'application/pdf').expect(400);
    // SVG is an image to a human and a script host to a browser. It must stay refused.
    await upload(sessionId, u1, png(), 'image/svg+xml').expect(400);
  });

  it('refuses bytes that do not match the declared type', async () => {
    // The header is a claim by the client (rule 2). Without this check, HTML labelled
    // image/png is stored and later served back.
    const sessionId = await makeSession();
    await upload(sessionId, u1, notReallyAPng(), 'image/png').expect(400);
  });

  it('refuses an empty body', async () => {
    const sessionId = await makeSession();
    await upload(sessionId, u1, Buffer.alloc(0)).expect(400);
  });

  it('413s a file over the cap', async () => {
    const sessionId = await makeSession();
    await upload(sessionId, u1, png(7 * 1024 * 1024)).expect(413);
  });

  it('refuses evidence once the visit is terminal', async () => {
    // A late attachment would change what a verdict was about after it was reached.
    const sessionId = await makeSession({ state: 'submitted' });
    await upload(sessionId, u1, png()).expect(400);
  });

  it('accepts evidence on an ended visit, because the report is written after the end', async () => {
    const sessionId = await makeSession({ state: 'ended' });
    await upload(sessionId, u1, png()).expect(201);
  });

  /* ------------------------------------------------------------- ownership */

  it('will not let one visit claim another visit’s photo', async () => {
    const mine = await makeSession({ participantId: 'u-participant-1' });
    const theirs = await makeSession({ participantId: 'u-participant-2' });
    const res = await upload(theirs, u2, png()).expect(201);
    const key = (res.body as { evidenceKey: string }).evidenceKey;

    const service = app.get(EvidenceService);
    await expect(service.assertBelongsTo(key, mine)).rejects.toThrow();
    await expect(service.assertBelongsTo(key, theirs)).resolves.toBeUndefined();
  });

  /* ----------------------------------------------------------------- reading */

  it('lets the owning participant read it back, with the bytes intact', async () => {
    const sessionId = await makeSession({ participantId: 'u-participant-1' });
    const key = (
      (await upload(sessionId, u1, png(128)).expect(201)).body as { evidenceKey: string }
    ).evidenceKey;

    const res = await request(app.getHttpServer())
      .get(`/evidence/${key}`)
      .set(auth(u1))
      .expect(200);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-disposition']).toContain('attachment');
    expect(res.body.length).toBe(128);
  });

  it('403s another participant reading it', async () => {
    const sessionId = await makeSession({ participantId: 'u-participant-1' });
    const key = (
      (await upload(sessionId, u1, png()).expect(201)).body as { evidenceKey: string }
    ).evidenceKey;
    await request(app.getHttpServer()).get(`/evidence/${key}`).set(auth(u2)).expect(403);
  });

  it('lets a business user read evidence from their own org and refuses another’s', async () => {
    const mineOrg = await makeSession({ participantId: 'u-participant-1', org: ORG });
    const foreignOrg = await makeSession({ participantId: 'u-participant-1', org: OTHER_ORG });

    const mineKey = (
      (await upload(mineOrg, u1, png()).expect(201)).body as { evidenceKey: string }
    ).evidenceKey;
    const foreignKey = (
      (await upload(foreignOrg, u1, png()).expect(201)).body as { evidenceKey: string }
    ).evidenceKey;

    // Org membership is necessary but no longer sufficient: the client sees a photo once the
    // participant has SUBMITTED it, not merely because it was uploaded in their org.
    await request(app.getHttpServer()).get(`/evidence/${mineKey}`).set(auth(biz)).expect(403);
    await Reports.create({
      sessionId: mineOrg,
      clientOrgId: ORG,
      participantId: 'u-participant-1',
      notes: 'A submitted report referencing the photo.',
      rating: 4,
      evidenceKey: mineKey,
      submittedAt: new Date(),
    } as never);
    await request(app.getHttpServer()).get(`/evidence/${mineKey}`).set(auth(biz)).expect(200);

    await request(app.getHttpServer())
      .get(`/evidence/${foreignKey}`)
      .set(auth(otherBiz))
      .expect(403);
  });

  it('lets an admin read any org’s evidence', async () => {
    const sessionId = await makeSession({ participantId: 'u-participant-1', org: OTHER_ORG });
    const key = (
      (await upload(sessionId, u1, png()).expect(201)).body as { evidenceKey: string }
    ).evidenceKey;
    await request(app.getHttpServer()).get(`/evidence/${key}`).set(auth(admin)).expect(200);
  });

  it('404s an unknown or malformed key rather than throwing', async () => {
    await request(app.getHttpServer())
      .get('/evidence/65b0000000000000000000aa')
      .set(auth(u1))
      .expect(404);
    await request(app.getHttpServer()).get('/evidence/not-an-id').set(auth(u1)).expect(404);
  });

  it('replaces the previous photo rather than accumulating objects', async () => {
    // The exhaustion path the schema-reviewer found: on a 512 MB Atlas M0, orphaned photos
    // never expire while pings do, and Atlas refuses writes DATABASE-WIDE when it fills.
    const sessionId = await makeSession({ participantId: 'u-participant-1' });
    const first = ((await upload(sessionId, u1, png(64)).expect(201)).body as { evidenceKey: string })
      .evidenceKey;
    const second = ((await upload(sessionId, u1, png(96)).expect(201)).body as { evidenceKey: string })
      .evidenceKey;

    expect(second).not.toBe(first);
    const files = await conn.db!.collection('evidence.files')
      .find({ 'metadata.sessionId': sessionId })
      .toArray();
    expect(files).toHaveLength(1);
    expect(String(files[0]!._id)).toBe(second);

    // And the bytes are gone too, not just the file document.
    const chunks = await conn.db!.collection('evidence.chunks')
      .countDocuments({ files_id: new mongoose.Types.ObjectId(first) });
    expect(chunks).toBe(0);
  });
});
