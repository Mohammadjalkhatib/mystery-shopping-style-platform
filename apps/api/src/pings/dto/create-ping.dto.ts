import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsISO8601,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsPositive,
  IsString,
  Length,
  Max,
  ValidateNested,
} from 'class-validator';

/**
 * One fix, as a client is allowed to describe it.
 *
 * This class is the whole of rule 2 in one place: if a field is not declared here, the global
 * `ValidationPipe` with `forbidNonWhitelisted: true` **rejects the request with a 400 naming
 * the field**. It does not strip it and return 201. That distinction matters -- silently
 * dropping a client-supplied `distanceM` teaches an attacker nothing and teaches us nothing
 * either (D-012).
 *
 * Server-owned and therefore absent by design: `receivedAt`, `distanceM`, `presence`, and
 * anything resembling "I am at the venue".
 */
export class CreatePingFixDto {
  /**
   * Client-generated UUID. The idempotency key (rule 4), and the one field the client is
   * supposed to own. It carries no meaning beyond identity, so a malicious value gains the
   * attacker nothing -- the worst they can do is collide with their own earlier fix.
   */
  @IsString()
  @Length(8, 64)
  clientPingId!: string;

  /**
   * Device clock. UNTRUSTED (rule 3). Kept because the delta against the server clock is a
   * verification signal, and bounded against the session window by the service.
   */
  @IsISO8601()
  capturedAt!: string;

  @IsLatitude()
  lat!: number;

  @IsLongitude()
  lng!: number;

  /**
   * Browser-reported accuracy in metres.
   *
   * `@IsPositive` because a non-positive accuracy is physically impossible and an accuracy of
   * zero sails straight through the presence rule, granting a free geofence (D-010). Capped
   * at 100 km so a garbage value cannot overflow the maths downstream.
   *
   * NOT rounded, anywhere. Android's fused provider legitimately reports a quantised,
   * repeating accuracy for a stationary device on the same Wi-Fi scan, and rounding here
   * would trip the engine's `distinct === 1` spoof branch on honest traces (D-010).
   */
  /**
   * NOTE: no `maxDecimalPlaces`.
   *
   * It was there and it was a bug. `coords.accuracy` is an arbitrary double, and ordinary
   * float arithmetic produces values like 11.399999999999999 — so a cap of six decimal
   * places rejected honest fixes with a 400 while an attacker, who picks round numbers,
   * sailed through. Caught by a live end-to-end probe, not by the unit tests, because every
   * fixture used tidy values.
   *
   * Precision is not a threat here. The real constraints are that it must be positive (zero
   * grants a free geofence, D-010) and bounded, and that it must never be rounded — Android
   * reports quantised repeats and rounding would trip the engine's constant-accuracy spoof
   * branch on an honest trace.
   */
  @IsNumber()
  @IsPositive()
  @Max(100_000)
  accuracyM!: number;
}

/**
 * A batch. Up to 20 fixes, so an offline queue can flush in bounded chunks (CLAUDE.md rule 4).
 */
export class CreatePingBatchDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => CreatePingFixDto)
  fixes!: CreatePingFixDto[];
}
