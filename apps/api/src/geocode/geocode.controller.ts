import { Controller, Get, Query } from '@nestjs/common';
import { Roles } from '../auth/auth.decorators.js';
import { GeocodeService } from './geocode.service.js';
import type { GeocodeResult } from './nominatim.js';

@Controller('geocode')
export class GeocodeController {
  constructor(private readonly geocode: GeocodeService) {}

  /**
   * Address search for the venue picker.
   *
   * Role-guarded to the people who author venues. Not because the results are sensitive --
   * they are public map data -- but because this endpoint spends a shared, rate-limited
   * quota on an external service, and an unauthenticated one is a free way for anyone to
   * exhaust it and get the application blocked.
   */
  @Roles('admin', 'business')
  @Get()
  search(@Query('q') q?: string): Promise<GeocodeResult[]> {
    return this.geocode.search(q ?? '');
  }
}
