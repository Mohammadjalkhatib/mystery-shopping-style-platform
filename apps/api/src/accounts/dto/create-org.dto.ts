import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

/**
 * A new business account: the organisation and the first user who can sign into it.
 *
 * One request, not two, because an organisation with no user in it is unreachable -- it can
 * be created, listed and assigned to, and nobody can ever log in and see it. That is the same
 * failure `createAssignment` avoids by writing the assignment and its session together, and
 * it is written here as one transaction for the same reason.
 *
 * There is no password field. Every account gets `DEFAULT_PASSWORD` (D-037): this build has no
 * mail transport, so the alternative is a generated password displayed once and lost when the
 * dialog closes.
 */
export class CreateOrgDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  /**
   * The organisation's stable identifier. `ClientOrg._id` becomes `org-<slug>`, matching the
   * seeded `org-alfa-retail`, so the id in the database stays readable rather than being an
   * ObjectId nobody can trace back to a customer (D-014).
   *
   * Restricted to a URL-safe shape because it ends up inside an id string. Not because of an
   * injection risk -- Mongoose parameterises -- but because an org id with a space or a slash
   * in it is the kind of value that survives every test and breaks one report six weeks later.
   */
  @IsString()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'slug must be lowercase letters, digits and single hyphens',
  })
  @MinLength(2)
  @MaxLength(40)
  slug!: string;

  /** The username of the business account's first sign-in. */
  @IsString()
  @Matches(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/, {
    message: 'username must be lowercase letters, digits, and single . _ or - separators',
  })
  @MinLength(3)
  @MaxLength(32)
  businessUsername!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(80)
  businessDisplayName!: string;
}
