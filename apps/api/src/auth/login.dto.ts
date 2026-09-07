import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Only two fields exist, so `forbidNonWhitelisted` rejects anything else with a 400 naming
 * the offending field. CLAUDE.md rule 2: reject, do not silently strip. In particular a
 * client cannot post `role` here and have it ignored -- it is refused.
 */
export class LoginDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  username!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password!: string;
}
