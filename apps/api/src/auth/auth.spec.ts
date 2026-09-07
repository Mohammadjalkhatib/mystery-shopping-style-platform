import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AuthModule } from './auth.module.js';
import { DEMO_PASSWORD } from './demo-users.js';

/**
 * One test per authorization boundary, per CLAUDE.md section 5.
 *
 * The credentials behind these are fake (D-008) but the boundaries are not, and these are
 * the tests that stop a later branch from quietly adding an unguarded controller.
 */
describe('auth boundaries', () => {
  let app: INestApplication;

  const login = async (username: string, password = DEMO_PASSWORD): Promise<string> => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ username, password })
      .expect(200);
    return (res.body as { token: string }).token;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        AuthModule,
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
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
      await request(app.getHttpServer()).get('/auth/demo-credentials').expect(200);
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
      const res = await request(app.getHttpServer())
        .get('/auth/demo-credentials')
        .expect(200);
      const body = res.body as { accounts: { username: string; role: string }[] };
      const names = body.accounts.map((a) => a.username);

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
  });
});
