import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/**
 * A new venue and its geofence.
 *
 * `lat` and `lng` are named explicitly and stored as `[lng, lat]` by the service. The schema
 * comment on GeoPoint says why that conversion lives in exactly one place: a transposed pair
 * is a plausible typo that relocates a venue by roughly 1,900 km, after which every honest
 * visit there is correctly rejected and it reads as an engine bug.
 *
 * `radiusM` is bounded here AND on the schema, deliberately. The schema bound is the one that
 * a seed script or a migration cannot get around; this one exists to produce a 400 that names
 * the field instead of a Mongoose validation error. D-010: an unbounded radius is an attack,
 * not a typo -- a venue saved at 5000 m auto-verifies most of a city.
 */
export class CreateVenueDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(200)
  address!: string;

  @Type(() => Number)
  @IsLatitude()
  lat!: number;

  @Type(() => Number)
  @IsLongitude()
  lng!: number;

  @Type(() => Number)
  @IsInt()
  @Min(25)
  @Max(500)
  radiusM!: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(500)
  nearBufferM?: number;

  @IsOptional()
  @IsBoolean()
  indoor?: boolean;

  /**
   * Which organisation the venue belongs to.
   *
   * Required for an admin, who has no org of their own, and REJECTED for a business user,
   * whose org comes from the verified token (D-017, rule 2). That is conditional on the
   * caller's role, which class-validator cannot express without the request context, so the
   * service enforces it rather than the DTO.
   */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  clientOrgId?: string;
}
