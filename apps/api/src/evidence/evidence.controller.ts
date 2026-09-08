import {
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Req,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { AuthUser } from '@msp/shared';
import type { Readable } from 'node:stream';
import { CurrentUser, Roles } from '../auth/auth.decorators.js';
import { EvidenceService } from './evidence.service.js';

/** The two response methods needed here, structurally -- see the note in console.controller. */
interface ResponseLike {
  setHeader(name: string, value: string): void;
}

@Controller()
export class EvidenceController {
  constructor(private readonly evidence: EvidenceService) {}

  /**
   * Attach one photo to a visit.
   *
   * The body is the raw image, not multipart. That avoids `multer` and `@types/multer` for a
   * single-file endpoint, and it means the bytes are streamed and counted rather than parsed
   * into memory by a library first. A phone sends this straight from a file input.
   */
  @Roles('participant')
  @Post('sessions/:sessionId/evidence')
  async upload(
    @Param('sessionId') sessionId: string,
    @CurrentUser() user: AuthUser,
    @Headers('content-type') contentType: string,
    @Req() req: Readable,
  ): Promise<{ evidenceKey: string; bytes: number; contentType: string }> {
    return this.evidence.store(sessionId, user, (contentType ?? '').split(';')[0]!.trim(), req);
  }

  /**
   * Read a photo back.
   *
   * Two headers are load-bearing, not decoration. `Content-Disposition: attachment` and
   * `X-Content-Type-Options: nosniff` together mean that even if something got past the
   * magic-byte check at upload, a browser will not render it as a document in this origin.
   * The stored file is user-supplied content and is treated as such on the way out too.
   */
  @Roles('participant', 'business', 'admin')
  @Get('evidence/:evidenceKey')
  async read(
    @Param('evidenceKey') evidenceKey: string,
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) res: ResponseLike,
  ): Promise<StreamableFile> {
    const { stream, contentType, bytes } = await this.evidence.read(evidenceKey, user);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', String(bytes));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', `attachment; filename="evidence-${evidenceKey}"`);
    res.setHeader('Cache-Control', 'private, max-age=300');
    return new StreamableFile(stream);
  }
}
