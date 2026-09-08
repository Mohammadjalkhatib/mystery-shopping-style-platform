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
 * Correcting a venue. Every field optional; only what is sent is changed.
 *
 * `clientOrgId` is absent entirely, unlike on create. A venue cannot be moved between
 * organisations: the tasks, assignments and sessions hanging off it all carry their own
 * `clientOrgId`, so re-homing the venue alone would split one visit across two tenants and
 * nothing downstream would notice (D-021).
 *
 * `lat` and `lng` must be sent together or not at all -- half a coordinate is not a location,
 * and the precision check has to see both to mean anything. The service enforces that pairing.
 */
export class UpdateVenueDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  address?: string;

  @IsOptional()
  @Type(() => Number)
  @IsLatitude()
  lat?: number;

  @IsOptional()
  @Type(() => Number)
  @IsLongitude()
  lng?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(25)
  @Max(500)
  radiusM?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(500)
  nearBufferM?: number;

  @IsOptional()
  @IsBoolean()
  indoor?: boolean;
}
