import { Module } from '@nestjs/common';
import { GeocodeController } from './geocode.controller.js';
import { GeocodeService } from './geocode.service.js';

/**
 * Its own module, not part of `geo/`.
 *
 * `geo/` is pure -- haversine and the precision rule -- and this does network I/O, holds a
 * cache and enforces a rate limit. Keeping them apart is what stops the pure half growing a
 * dependency that would make it untestable.
 */
@Module({
  controllers: [GeocodeController],
  providers: [GeocodeService],
})
export class GeocodeModule {}
