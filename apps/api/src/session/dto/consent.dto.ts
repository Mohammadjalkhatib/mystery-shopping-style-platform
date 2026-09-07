import { IsString, Matches } from 'class-validator';

/**
 * Consent, versioned.
 *
 * The client states WHICH text it displayed. It cannot state when it consented or on whose
 * behalf -- both are server-owned (rule 2). Versioning matters because the consent text will
 * change and "they agreed to something" is not an auditable claim; "they agreed to v1 at
 * 14:02 server time" is.
 */
export class ConsentDto {
  @IsString()
  @Matches(/^v\d+$/, { message: 'consentVersion must look like v1' })
  consentVersion!: string;
}
