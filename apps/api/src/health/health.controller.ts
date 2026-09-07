import { Controller, Get } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
// `import type`, not a value import. Mongoose is CommonJS; Node's cjs-module-lexer cannot
// statically detect `Connection` as a named export, so a value import compiles cleanly and
// then throws at runtime. Type-only imports are erased, so they are always safe.
// See docs/DECISIONS.md D-007 for the general rule.
import type { Connection } from 'mongoose';
import { Public } from '../auth/auth.decorators.js';

/**
 * Liveness plus a real dependency check. Docker compose and the free-tier host both need a
 * cheap endpoint, and "the process is up but Mongo is not" is the failure worth catching.
 */
@Controller('health')
export class HealthController {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  // Container healthchecks and the free-tier warm-up ping have no token.
  @Public()
  @Get()
  check(): { status: string; mongo: string; uptimeS: number } {
    // 1 === connected, per Mongoose's readyState enum.
    const mongo = this.connection.readyState === 1 ? 'up' : 'down';
    return {
      status: mongo === 'up' ? 'ok' : 'degraded',
      mongo,
      uptimeS: Math.round(process.uptime()),
    };
  }
}
