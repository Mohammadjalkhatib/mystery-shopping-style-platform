import { IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

/**
 * A new user inside an organisation.
 *
 * `role` is narrowed to the two roles that can be created at all. `admin` is absent on
 * purpose: a platform administrator sees and writes every organisation, and nothing in this
 * build needs a second one, so the only way to get one is the seed. Widening this is a
 * deliberate act rather than an oversight.
 *
 * `clientOrgId` is optional here and is NOT the authority on tenancy. A business user may not
 * send one -- their token already says which organisation they are, and a body field that can
 * disagree with the token is the tenancy boundary written as a suggestion (rule 2, D-017).
 * The service refuses a mismatch rather than ignoring it.
 */
export class CreateUserDto {
  @IsString()
  @Matches(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/, {
    message: 'username must be lowercase letters, digits, and single . _ or - separators',
  })
  @MinLength(3)
  @MaxLength(32)
  username!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(80)
  displayName!: string;

  @IsIn(['participant', 'business'])
  role!: 'participant' | 'business';

  @IsOptional()
  @IsString()
  @MaxLength(64)
  clientOrgId?: string;
}
