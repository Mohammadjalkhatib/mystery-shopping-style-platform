import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { EvaluatorService } from './evaluator.service.js';

/** How often the queue is swept when nothing has explicitly poked it. */
export const SWEEP_MS = 15_000;

/**
 * What actually runs the evaluator.
 *
 * Two triggers, deliberately, because neither alone is sufficient:
 *
 * 1. **`kick()` after a submit.** This is what makes the demo feel right -- the verdict lands
 *    a moment after the report, and the console updates with no refresh (D-004). It is
 *    fire-and-forget: submit must stay a fast transactional write (rule 9) and must NOT fail
 *    because the evaluator is slow or broken.
 *
 * 2. **A periodic sweep.** The kick is best-effort and in-process, so it is lost on a crash,
 *    a deploy mid-request, or an outbox row written by anything that is not the submit path.
 *    Rule 9 promises the evaluator "can retry and can be re-run"; a trigger that only fires
 *    on the happy path does not deliver that. The sweep is what makes the outbox durable
 *    rather than decorative.
 *
 * Not `@nestjs/schedule`. A plain interval does the same job here without the module, and
 * D-003's assumption that a cron solves the reaper is separately doubtful on a free tier that
 * sleeps -- see the open item on the reaper in docs/MEMORY.md.
 */
@Injectable()
export class EvaluatorRunner implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('EvaluatorRunner');
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly evaluator: EvaluatorService) {}

  onModuleInit(): void {
    // unref() so a pending sweep never holds the process open, which would otherwise make
    // tests and graceful shutdown hang.
    this.timer = setInterval(() => void this.sweep(), SWEEP_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * Nudge the evaluator now. Never throws, never awaited by the caller.
   *
   * The submit path calls this and moves on. If it fails, the sweep picks the row up.
   */
  kick(): void {
    void this.sweep();
  }

  /** Guarded so overlapping triggers cannot run two drains at once in this process. */
  private async sweep(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const n = await this.evaluator.drain();
      if (n > 0) this.logger.log(`Evaluated ${n} visit(s).`);
    } catch (err) {
      // Swallowed on purpose: a failing sweep must not take down the process. Individual row
      // failures are already recorded on the outbox row with a backoff.
      this.logger.error(
        `Evaluator sweep failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      this.running = false;
    }
  }
}
