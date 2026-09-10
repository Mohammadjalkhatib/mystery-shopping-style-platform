import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose, { type Connection, type Model } from 'mongoose';
import request from 'supertest';
import { seedDemoUsers } from '../../test/seed-users.js';
import { AuthModule } from '../auth/auth.module.js';
import { DEFAULT_PASSWORD } from '../auth/demo-users.js';
import { ClientOrg, ClientOrgSchema } from '../db/schemas/org-venue.schema.js';
import { User, UserSchema } from '../db/schemas/user.schema.js';
import { AccountsController } from './accounts.controller.js';
import { AccountsService } from './accounts.service.js';
import { testDbModule } from '../../test/nest-db.js';

/** The org the demo `business` user belongs to, per demo-users.ts. */
const ORG = 'org-alfa-retail';
const OTHER_ORG = 'org-someone-else';

/**
 * Account administration, and one test per authorization boundary (CLAUDE.md section 5).
 *
 * These are the boundaries D-037 adds, and they are the ones worth the most care in the whole
 * feature: everything else in this system is guarded by a role check that was written once and
 * tested once, whereas creating accounts is the first place where a *tenant* can write rows
 * that another tenant's queries will read. A mistake here is not a wrong verdict, it is a
 * business seeing another business's staff.
 */
describe('accounts', () => {
  let mongod: MongoMemoryReplSet;
  let conn: Connection;
  let app: INestApplication;

  let Orgs: Model<ClientOrg>;
  let Users: Model<User>;

  let adminToken: string;
  let bizToken: string;
  let participantToken: string;

  const login = async (username: string, password = DEFAULT_PASSWORD): Promise<string> => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ username, password })
      .expect(200);
    return (res.body as { token: string }).token;
  };
  const auth = (tok: string) => ({ Authorization: `Bearer ${tok}` });

  /** Unique per call, so a test never fails because an earlier one took the name. */
  let seq = 0;
  const uniq = (prefix: string): string => `${prefix}${(seq += 1)}`;

  beforeAll(async () => {
    mongod = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    conn = await mongoose.createConnection(mongod.getUri('accounts')).asPromise();

    Orgs = conn.model(ClientOrg.name, ClientOrgSchema) as Model<ClientOrg>;
    Users = conn.model(User.name, UserSchema) as Model<User>;
    // Uniqueness is asserted by several tests below, and Mongoose only builds indexes on
    // demand against a fresh database.
    await Promise.all([Orgs.createIndexes(), Users.createIndexes()]);

    await seedDemoUsers(conn);
    await Orgs.create([
      { _id: ORG, name: 'Alfa Retail', slug: 'alfa-retail' },
      { _id: OTHER_ORG, name: 'Someone Else', slug: 'someone-else' },
    ] as never);

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        testDbModule(conn),
        AuthModule,
      ],
      controllers: [AccountsController],
      providers: [
        AccountsService,
        { provide: getConnectionToken(), useValue: conn },
        { provide: getModelToken(ClientOrg.name), useValue: Orgs },
        { provide: getModelToken(User.name), useValue: Users },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();

    adminToken = await login('admin');
    bizToken = await login('business');
    participantToken = await login('user1');
  });

  afterAll(async () => {
    await app.close();
    await conn.close();
    await mongod.stop();
  });

  /* ------------------------------------------------------- creating an org */

  describe('an admin creates a business account', () => {
    it('writes the organisation and a working sign-in together', async () => {
      const slug = uniq('acme-');
      const username = uniq('acme.owner');

      const res = await request(app.getHttpServer())
        .post('/orgs')
        .set(auth(adminToken))
        .send({
          name: 'Acme Retail',
          slug,
          businessUsername: username,
          businessDisplayName: 'Acme Retail (Business)',
        })
        .expect(201);

      const body = res.body as {
        org: { id: string; slug: string; userCount: number };
        businessUser: { id: string; role: string; clientOrgId: string; active: boolean };
      };
      expect(body.org.id).toBe(`org-${slug}`);
      expect(body.businessUser).toMatchObject({
        id: `u-${username}`,
        role: 'business',
        clientOrgId: `org-${slug}`,
        active: true,
      });

      // The point of the whole endpoint: the account can actually be used.
      const token = await login(username);
      const me = await request(app.getHttpServer()).get('/auth/me').set(auth(token)).expect(200);
      expect(me.body).toMatchObject({ role: 'business', clientOrgId: `org-${slug}` });
    });

    it('never returns the password hash', async () => {
      const slug = uniq('nohash-');
      const res = await request(app.getHttpServer())
        .post('/orgs')
        .set(auth(adminToken))
        .send({
          name: 'No Hash Ltd',
          slug,
          businessUsername: uniq('nohash.owner'),
          businessDisplayName: 'No Hash',
        })
        .expect(201);
      expect(JSON.stringify(res.body)).not.toContain('passwordHash');
      expect(JSON.stringify(res.body)).not.toContain(DEFAULT_PASSWORD);
    });

    /**
     * Both halves or neither. An organisation with no user in it is unreachable -- it can be
     * listed and assigned to and nobody can ever sign in and look at it.
     */
    it('writes no organisation when the username is already taken', async () => {
      const slug = uniq('rollback-');
      await request(app.getHttpServer())
        .post('/orgs')
        .set(auth(adminToken))
        .send({
          name: 'Rollback Ltd',
          slug,
          businessUsername: 'business', // already exists, from the seeded roster
          businessDisplayName: 'Rollback',
        })
        .expect(409);

      expect(await Orgs.findById(`org-${slug}`).lean()).toBeNull();
    });

    it('rejects a slug that is not url-safe', async () => {
      await request(app.getHttpServer())
        .post('/orgs')
        .set(auth(adminToken))
        .send({
          name: 'Bad Slug',
          slug: 'Not A Slug',
          businessUsername: uniq('badslug'),
          businessDisplayName: 'Bad Slug',
        })
        .expect(400);
    });
  });

  /* -------------------------------------------------- creating users, rules */

  describe('a business creates its own participants', () => {
    it('creates a participant who can sign in', async () => {
      const username = uniq('shopper');
      const res = await request(app.getHttpServer())
        .post('/users')
        .set(auth(bizToken))
        .send({ username, displayName: 'A Shopper', role: 'participant' })
        .expect(201);

      expect(res.body).toMatchObject({
        role: 'participant',
        clientOrgId: ORG,
        active: true,
      });

      const token = await login(username);
      const me = await request(app.getHttpServer()).get('/auth/me').set(auth(token)).expect(200);
      expect(me.body).toMatchObject({ username, role: 'participant', clientOrgId: ORG });
    });

    it('records who created the account', async () => {
      const username = uniq('audited');
      await request(app.getHttpServer())
        .post('/users')
        .set(auth(bizToken))
        .send({ username, displayName: 'Audited', role: 'participant' })
        .expect(201);

      const row = await Users.findById(`u-${username}`).lean<{ createdBy: string }>();
      expect(row!.createdBy).toBe('u-business');
    });

    it('refuses a duplicate username with a 409, not a 500', async () => {
      const username = uniq('twice');
      const body = { username, displayName: 'Twice', role: 'participant' };
      await request(app.getHttpServer()).post('/users').set(auth(bizToken)).send(body).expect(201);
      await request(app.getHttpServer()).post('/users').set(auth(bizToken)).send(body).expect(409);
    });
  });

  /**
   * The boundaries. One test each, and each one describes an attack rather than a rule:
   * the rule is obvious, what it prevents is the part worth writing down.
   */
  describe('authorization boundaries', () => {
    it('forbids a participant from creating an organisation', async () => {
      await request(app.getHttpServer())
        .post('/orgs')
        .set(auth(participantToken))
        .send({
          name: 'Self Service',
          slug: uniq('self-'),
          businessUsername: uniq('self'),
          businessDisplayName: 'Self',
        })
        .expect(403);
    });

    it('forbids a participant from creating a user', async () => {
      await request(app.getHttpServer())
        .post('/users')
        .set(auth(participantToken))
        .send({ username: uniq('mine'), displayName: 'Mine', role: 'participant' })
        .expect(403);
    });

    /**
     * A business creating an organisation would be creating a tenancy boundary that it also
     * sits outside of.
     */
    it('forbids a business from creating an organisation', async () => {
      await request(app.getHttpServer())
        .post('/orgs')
        .set(auth(bizToken))
        .send({
          name: 'Sibling Co',
          slug: uniq('sibling-'),
          businessUsername: uniq('sibling'),
          businessDisplayName: 'Sibling',
        })
        .expect(403);
    });

    /**
     * The escalation this feature would otherwise hand out for free: a business user creating
     * a peer with full write access to the organisation's venues, tasks and review decisions.
     */
    it('forbids a business from creating another business user', async () => {
      await request(app.getHttpServer())
        .post('/users')
        .set(auth(bizToken))
        .send({ username: uniq('peer'), displayName: 'Peer', role: 'business' })
        .expect(403);
    });

    /** And the bigger one: a platform admin. Refused by the DTO before it reaches the service. */
    it('rejects role: admin outright, from anyone', async () => {
      for (const token of [bizToken, adminToken]) {
        await request(app.getHttpServer())
          .post('/users')
          .set(auth(token))
          .send({ username: uniq('root'), displayName: 'Root', role: 'admin' })
          .expect(400);
      }
    });

    /**
     * Rule 2: reject a server-owned field, do not ignore it. `active` and `passwordHash` are
     * decided here, and a request that tries to set them must fail loudly rather than appear
     * to have worked.
     */
    it('rejects a body that tries to set active or passwordHash', async () => {
      await request(app.getHttpServer())
        .post('/users')
        .set(auth(bizToken))
        .send({
          username: uniq('sneaky'),
          displayName: 'Sneaky',
          role: 'participant',
          active: false,
        })
        .expect(400);

      await request(app.getHttpServer())
        .post('/users')
        .set(auth(bizToken))
        .send({
          username: uniq('sneaky'),
          displayName: 'Sneaky',
          role: 'participant',
          passwordHash: 'scrypt$16384$8$1$AAAA$BBBB',
        })
        .expect(400);
    });

    it("forbids a business from creating a user in another organisation", async () => {
      await request(app.getHttpServer())
        .post('/users')
        .set(auth(bizToken))
        .send({
          username: uniq('poach'),
          displayName: 'Poach',
          role: 'participant',
          clientOrgId: OTHER_ORG,
        })
        .expect(403);
    });

    it('requires an admin to name an organisation, rather than guessing one', async () => {
      await request(app.getHttpServer())
        .post('/users')
        .set(auth(adminToken))
        .send({ username: uniq('orphan'), displayName: 'Orphan', role: 'participant' })
        .expect(400);
    });

    /**
     * A dangling org id produces an account that signs in perfectly and has an empty console
     * forever, with nothing anywhere to say why. Refuse it at creation instead.
     */
    it('refuses an admin naming an organisation that does not exist', async () => {
      await request(app.getHttpServer())
        .post('/users')
        .set(auth(adminToken))
        .send({
          username: uniq('nowhere'),
          displayName: 'Nowhere',
          role: 'participant',
          clientOrgId: 'org-does-not-exist',
        })
        .expect(404);
    });
  });

  /* --------------------------------------------------------------- reading */

  describe('listing', () => {
    it('shows a business only its own organisation, and an admin everyone', async () => {
      const outsider = uniq('outsider');
      await request(app.getHttpServer())
        .post('/users')
        .set(auth(adminToken))
        .send({
          username: outsider,
          displayName: 'Outsider',
          role: 'participant',
          clientOrgId: OTHER_ORG,
        })
        .expect(201);

      const asBiz = await request(app.getHttpServer())
        .get('/users')
        .set(auth(bizToken))
        .expect(200);
      const bizRows = asBiz.body as { username: string; clientOrgId: string }[];
      expect(bizRows.every((r) => r.clientOrgId === ORG)).toBe(true);
      expect(bizRows.map((r) => r.username)).not.toContain(outsider);

      const asAdmin = await request(app.getHttpServer())
        .get('/users')
        .set(auth(adminToken))
        .expect(200);
      expect((asAdmin.body as { username: string }[]).map((r) => r.username)).toContain(outsider);
    });

    it('never includes a password hash in a listing', async () => {
      const res = await request(app.getHttpServer())
        .get('/users')
        .set(auth(adminToken))
        .expect(200);
      expect(JSON.stringify(res.body)).not.toContain('passwordHash');
      expect(JSON.stringify(res.body)).not.toContain('scrypt$');
    });

    it('shows a business only its own organisation in the org list', async () => {
      const res = await request(app.getHttpServer())
        .get('/orgs')
        .set(auth(bizToken))
        .expect(200);
      expect((res.body as { id: string }[]).map((o) => o.id)).toEqual([ORG]);
    });

    it('forbids a participant from listing accounts', async () => {
      await request(app.getHttpServer()).get('/users').set(auth(participantToken)).expect(403);
      await request(app.getHttpServer()).get('/orgs').set(auth(participantToken)).expect(403);
    });
  });

  /* ---------------------------------------------------------- deactivation */

  describe('deactivation', () => {
    it('stops the account signing in, and leaves its visits alone', async () => {
      const username = uniq('leaver');
      const created = await request(app.getHttpServer())
        .post('/users')
        .set(auth(bizToken))
        .send({ username, displayName: 'Leaver', role: 'participant' })
        .expect(201);
      const id = (created.body as { id: string }).id;

      await login(username);

      await request(app.getHttpServer())
        .patch(`/users/${id}`)
        .set(auth(bizToken))
        .send({ active: false })
        .expect(200);

      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ username, password: DEFAULT_PASSWORD })
        .expect(401);

      // Still there, because sessions and append-only verification results reference it.
      expect(await Users.findById(id).lean()).not.toBeNull();
    });

    it('can be undone', async () => {
      const username = uniq('returner');
      const created = await request(app.getHttpServer())
        .post('/users')
        .set(auth(bizToken))
        .send({ username, displayName: 'Returner', role: 'participant' })
        .expect(201);
      const id = (created.body as { id: string }).id;

      const patch = (active: boolean) =>
        request(app.getHttpServer())
          .patch(`/users/${id}`)
          .set(auth(bizToken))
          .send({ active })
          .expect(200);

      await patch(false);
      await patch(true);
      await expect(login(username)).resolves.toEqual(expect.any(String));
    });

    /**
     * There is one admin and no way to make another through the product, so an admin who
     * switches themselves off has locked the platform's only administrator out of it with no
     * path back that does not involve a database client.
     */
    it('refuses to let anyone deactivate themselves', async () => {
      await request(app.getHttpServer())
        .patch('/users/u-admin')
        .set(auth(adminToken))
        .send({ active: false })
        .expect(400);
    });

    it("forbids a business from deactivating another organisation's user", async () => {
      const username = uniq('theirs');
      const created = await request(app.getHttpServer())
        .post('/users')
        .set(auth(adminToken))
        .send({
          username,
          displayName: 'Theirs',
          role: 'participant',
          clientOrgId: OTHER_ORG,
        })
        .expect(201);

      await request(app.getHttpServer())
        .patch(`/users/${(created.body as { id: string }).id}`)
        .set(auth(bizToken))
        .send({ active: false })
        .expect(403);
    });

    it('forbids a business from deactivating the platform admin', async () => {
      await request(app.getHttpServer())
        .patch('/users/u-admin')
        .set(auth(bizToken))
        .send({ active: false })
        .expect(403);
    });

    it('forbids a participant from deactivating anyone', async () => {
      await request(app.getHttpServer())
        .patch('/users/u-participant-2')
        .set(auth(participantToken))
        .send({ active: false })
        .expect(403);
    });
  });

  /* ------------------------------------------------- schema-level invariants */

  /**
   * The two states the collection must never reach, asserted against the database directly
   * rather than through the API.
   *
   * The API refuses both already. These exist because the schema-reviewer pass on this branch
   * found that the first attempt at the role/organisation invariant -- a field validator --
   * silently did not run on update paths, and because a comment claiming an invariant is not
   * the same thing as holding one. A seed script or a migration reaches this level directly.
   */
  describe('invariants the schema holds, not just the API', () => {
    it('refuses an admin with an organisation, and a business without one', async () => {
      await expect(
        Users.create({
          _id: 'u-bad-admin',
          username: 'bad.admin',
          displayName: 'Bad Admin',
          passwordHash: 'scrypt$16384$8$1$AAAA$BBBB',
          role: 'admin',
          clientOrgId: ORG,
        } as never),
      ).rejects.toThrow(/clientOrgId/);

      await expect(
        Users.create({
          _id: 'u-bad-biz',
          username: 'bad.biz',
          displayName: 'Bad Business',
          passwordHash: 'scrypt$16384$8$1$AAAA$BBBB',
          role: 'business',
          clientOrgId: null,
        } as never),
      ).rejects.toThrow(/clientOrgId/);
    });

    it('refuses to move an existing account between organisations', async () => {
      await expect(
        Users.updateOne({ _id: 'u-participant-3' }, { $set: { clientOrgId: OTHER_ORG } }),
      ).rejects.toThrow(/set once/);
    });

    it('refuses to promote an existing account to another role', async () => {
      await expect(
        Users.updateOne({ _id: 'u-participant-3' }, { $set: { role: 'admin' } }),
      ).rejects.toThrow(/set once/);
    });

    it('refuses deletion, because visits reference the account forever', async () => {
      await expect(Users.deleteOne({ _id: 'u-participant-3' })).rejects.toThrow(/never deleted/);
    });

    it('still allows the one update the product actually makes', async () => {
      await Users.updateOne({ _id: 'u-participant-3' }, { $set: { active: false } });
      await Users.updateOne({ _id: 'u-participant-3' }, { $set: { active: true } });
      const row = await Users.findById('u-participant-3').lean<{ active: boolean }>();
      expect(row!.active).toBe(true);
    });
  });
});
