import { Type } from 'class-transformer';
import { IsInt, IsMongoId, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

/**
 * A task defined against a venue.
 *
 * There is no `clientOrgId` here on purpose. The venue already carries one, so the task's org
 * is derived from it rather than restated -- a task whose org disagreed with its venue's would
 * be visible to one tenant and geofenced against another's location, and nothing downstream
 * would flag it.
 */
export class CreateTaskDto {
  @IsMongoId()
  venueId!: string;

  @IsString()
  @MinLength(3)
  @MaxLength(160)
  title!: string;

  @IsString()
  @MinLength(10, { message: 'brief must tell the participant what to actually do' })
  @MaxLength(2000)
  brief!: string;

  /** Bounded to match the schema. Feeds the engine's dwell expectation for this task. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(60)
  @Max(7200)
  expectedDwellSeconds?: number;
}
