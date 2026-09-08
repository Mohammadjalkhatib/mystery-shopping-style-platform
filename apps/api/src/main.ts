import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  /**
   * CLAUDE.md rule 2: DTOs must REJECT server-owned fields, not ignore them.
   * `forbidNonWhitelisted` is what turns a silently-stripped field into a 400 naming it.
   */
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  /**
   * CORS takes a LIST, because there is never exactly one origin in practice: the deployed
   * web app, and localhost while developing against the deployed API. Comma-separated so a
   * platform env var can carry it, trimmed because dashboard fields collect stray spaces.
   *
   * Credentials are not enabled: the token travels in an Authorization header, not a cookie,
   * so there is nothing here that a permissive origin could ride on.
   */
  const origins = (process.env.WEB_PUBLIC_URL ?? 'http://localhost:5173')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  app.enableCors({ origin: origins });

  /**
   * `PORT` first, because every container platform (Render, Cloud Run, Fly, Heroku) injects
   * it and ignores whatever the app would rather listen on. `API_PORT` stays as the local
   * name so compose and .env keep working unchanged.
   *
   * Getting this wrong does not fail loudly -- the app boots, binds 3000, and the platform's
   * health check times out against a port nothing is on.
   */
  const port = Number(process.env.PORT ?? process.env.API_PORT ?? 3000);
  await app.listen(port, '0.0.0.0');
  // eslint-disable-next-line no-console
  console.log(`[api] listening on :${port}, CORS origins: ${origins.join(', ')}`);
}

void bootstrap();
