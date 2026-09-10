import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { getConnectionToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose, { type Connection, type Model } from 'mongoose';
import request from 'supertest';
import { seedDemoUsers } from '../../test/seed-users.js';
import { User, UserSchema } from '../db/schemas/user.schema.js';
import { AuthModule } from './auth.module.js';
import { DEMO_PASSWORD } from './demo-users.js';
import { testDbModule } from '../../test/nest-db.js';

/**
 * One test per authorization boundary, per CLAUDE.md section 5.
 *
 * The accounts behind these are still demo accounts, but since D-037 they are real documents
 * in a real collection with scrypt-hashed passwords rather than an array -- so this spec now
 * needs a database, and the deactivation boundaries below are testable for the first time.
 * The boundaries themselves are unchanged, which was the whole point of the seam D-008 left.
 */
const SCRYPT_RECORD = /^scrypt\$\d+\$\d+\$\d+\$[^$]+\$[^$]+$/;

describe('auth boundaries', () => {
  let mongod: MongoMemoryReplSet;
  let conn: Connection;
  let Users: Model<User>;
  let app: INestApplication;

  const login = async (username: string, password = DEMO_PASSWORD): Promise<string> => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ username, password })
      .expect(200);
    return (res.body as { token: string }).token;
  };

  beforeAll(async () => {
    mongod = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    conn = await mongoose.createConnection(mongod.getUri('auth')).asPromise();
    Users = conn.model(User.name, UserSchema) as Model<User>;
    // The unique index on username is what makes a login answer for exactly one account.
    await Users.createIndexes();
    await seedDemoUsers(conn);

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        testDbModule(conn),
        AuthModule,
      ],
      providers: [{ provide: getConnectionToken(), useValue: conn }],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await conn.close();
    await mongod.stop();
  });

  describe('authentication', () => {
    it('rejects a protected route with no token', async () => {
      await request(app.getHttpServer()).get('/auth/me').expect(401);
    });

    it('rejects a token with a tampered signature', async () => {
      const token = await login('admin');
      const [body] = token.split('.');
      await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${body}.not-the-real-signature`)
        .expect(401);
    });

    it('rejects a tampered payload, because the signature no longer matches', async () => {
      const forged = Buffer.from(
        JSON.stringify({ sub: 'u-admin', exp: Date.now() + 100000 }),
      ).toString('base64url');
      await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${forged}.anything`)
        .expect(401);
    });

    it('rejects a malformed token', async () => {
      await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', 'Bearer garbage')
        .expect(401);
    });

    it('rejects a valid username with the wrong password', async () => {
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ username: 'admin', password: 'wrong' })
        .expect(401);
    });

    it('accepts a public route with no token', async () => {
      // POST /auth/login is the only @Public() route left. GET /auth/demo-credentials was
      // removed on this branch: backed by a real users collection it enumerated every
      // account on the platform, unauthenticated (D-037).
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ username: 'admin', password: DEMO_PASSWORD })
        .expect(200);
    });

    it('has no unauthenticated route that enumerates accounts', async () => {
      await request(app.getHttpServer()).get('/auth/demo-credentials').expect(404);
    });
  });

  describe('authorization', () => {
    it('admits an admin to an admin-only route', async () => {
      const token = await login('admin');
      await request(app.getHttpServer())
        .get('/auth/admin-only')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
    });

    it('forbids a participant from an admin-only route', async () => {
      const token = await login('user1');
      await request(app.getHttpServer())
        .get('/auth/admin-only')
        .set('Authorization', `Bearer ${token}`)
        .expect(403);
    });

    it('forbids a business user from an admin-only route', async () => {
      const token = await login('business');
      await request(app.getHttpServer())
        .get('/auth/admin-only')
        .set('Authorization', `Bearer ${token}`)
        .expect(403);
    });

    it('admits any authenticated role to a route with no @Roles()', async () => {
      const token = await login('user7');
      const res = await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body).toMatchObject({ username: 'user7', role: 'participant' });
    });
  });

  describe('untrusted client (rule 2)', () => {
    it('rejects a login payload carrying an extra field rather than ignoring it', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ username: 'user1', password: DEMO_PASSWORD, role: 'admin' })
        .expect(400);
      expect(JSON.stringify(res.body)).toContain('role');
    });

    it('never returns the password on a successful login', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ username: 'user3', password: DEMO_PASSWORD })
        .expect(200);
      expect(JSON.stringify(res.body)).not.toContain(DEMO_PASSWORD);
    });
  });

  describe('demo accounts', () => {
    it('seeds admin, business and user1 through user10', async () => {
      const names = (await Users.find({}, { username: 1 }).lean<{ username: string }[]>()).map(
        (u) => u.username,
      );
      expect(names).toContain('admin');
      expect(names).toContain('business');
      for (let n = 1; n <= 10; n++) expect(names).toContain(`user${n}`);
      expect(names).toHaveLength(12);
    });

    it('lets every one of the ten participants log in', async () => {
      for (let n = 1; n <= 10; n++) {
        await expect(login(`user${n}`)).resolves.toEqual(expect.any(String));
      }
    });

    it('stores the password hashed, never the password', async () => {
      const [row] = await Users.find({ username: 'user1' })
        .select('+passwordHash')
        .lean<{ passwordHash: string }[]>();
      expect(row!.passwordHash).toMatch(SCRYPT_RECORD);
      expect(row!.passwordHash).not.toContain(DEMO_PASSWORD);
    });

    it('leaves passwordHash out of an ordinary read, because it is select:false', async () => {
      const row = await Users.findOne({ username: 'user2' }).lean<Record<string, unknown>>();
      expect(row).not.toBeNull();
      expect(row).not.toHaveProperty('passwordHash');
    });
  });

  /**
   * Deactivation: the only control this system has over an account, and untestable before
   * there was a collection to hold it (D-037).
   *
   * The claim under test is specifically about IMMEDIACY. `AuthService.verify` re-reads the
   * user on every request instead of trusting the token payload, so a token issued before
   * deactivation has to stop working at once. Trusting the payload would leave a deactivated
   * account working for the seven days its token stays valid.
   */
  describe('deactivation (D-037)', () => {
    const DEACTIVATED = 'u-participant-9';

    afterEach(async () => {
      await Users.updateOne({ _id: DEACTIVATED }, { $set: { active: true } });
    });

    it('refuses a login for a deactivated account', async () => {
      await Users.updateOne({ _id: DEACTIVATED }, { $set: { active: false } });
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ username: 'user9', password: DEMO_PASSWORD })
        .expect(401);
    });

    it('kills a token issued before the account was deactivated', async () => {
      const token = await login('user9');
      await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      await Users.updateOne({ _id: DEACTIVATED }, { $set: { active: false } });

      await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(401);
    });

    /**
     * One answer for "no such user" and "wrong password". It mattered less when the roster
     * was published in the README; it matters now that a business names its own accounts.
     */
    it('answers the same for an unknown username and a wrong password', async () => {
      const unknown = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ username: 'nobody-at-all', password: DEMO_PASSWORD })
        .expect(401);
      const wrong = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ username: 'user1', password: 'not-the-password' })
        .expect(401);
      expect((unknown.body as { message: string }).message).toBe(
        (wrong.body as { message: string }).message,
      );
    });
  });
});
