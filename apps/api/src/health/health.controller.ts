import { Controller, Get } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
// `import type`, not a value import. Mongoose is CommonJS; Node's cjs-module-lexer cannot
// statically detect `Connection` as a named export, so a value import compiles cleanly and
// then throws at runtime. Type-only imports are erased, so they are always safe.
// See docs/DECISIONS.md D-007 for the general rule.
import type { Connection } from 'mongoose';
import { Public } from '../auth/auth.decorators.js';
import { EvidenceService } from '../evidence/evidence.service.js';

/**
 * Liveness plus a real dependency check. Docker compose and the free-tier host both need a
 * cheap endpoint, and "the process is up but Mongo is not" is the failure worth catching.
 */
@Controller('health')
export class HealthController {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    private readonly evidence: EvidenceService,
  ) {}

  // Container healthchecks and the free-tier warm-up ping have no token.
  @Public()
  @Get()
  check(): {
    status: string;
    mongo: string;
    evidence: { backend: string; ok: boolean };
    uptimeS: number;
  } {
    // 1 === connected, per Mongoose's readyState enum.
    const mongo = this.connection.readyState === 1 ? 'up' : 'down';
    const evidence = this.evidence.storeStatus;
    return {
      status: mongo === 'up' ? 'ok' : 'degraded',
      mongo,
      /**
       * Which backend photos go to, and whether it answered at boot.
       *
       * Public because it names no secret -- a backend kind and a boolean -- and because the
       * whole point is being able to confirm from a browser, immediately after pasting
       * credentials into a dashboard, that they actually worked. `detail` is deliberately NOT
       * exposed here: it contains the endpoint URL.
       */
      evidence: { backend: evidence.backend, ok: evidence.ok },
      uptimeS: Math.round(process.uptime()),
    };
  }
}
