import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

/**
 * Client organisation. The tenancy boundary: a business user sees visits for their org and
 * nothing else, and that filter is applied server-side from the token, never from a query
 * parameter (CLAUDE.md rule 2).
 */
@Schema({ collection: 'clientOrgs', timestamps: true })
export class ClientOrg {
  /**
   * A STRING id, not an ObjectId.
   *
   * Every other collection already stores `clientOrgId` as a string and compares it as one,
   * and the demo accounts carry a readable literal. Leaving this as a generated ObjectId meant
   * the seed and the demo users named the organisation differently, so the tenancy filter
   * never matched and the console was empty for every seeded visit (D-014).
   *
   * A stable, meaningful org id is also what makes the seed genuinely idempotent: re-running
   * it cannot create a second organisation.
   */
  @Prop({ type: String, required: true })
  _id!: string;

  @Prop({ required: true, trim: true })
  name!: string;

  @Prop({ required: true, unique: true, trim: true, lowercase: true })
  slug!: string;
}
export type ClientOrgDocument = HydratedDocument<ClientOrg>;
export const ClientOrgSchema = SchemaFactory.createForClass(ClientOrg);

/**
 * GeoJSON Point, stored in the order Mongo expects: [longitude, latitude].
 *
 * That ordering is the single most common bug in geospatial code, because every UI and every
 * conversation uses lat/lng. The venue schema exposes explicit `lat`/`lng` accessors so no
 * caller has to remember which way round this is.
 */
@Schema({ _id: false })
export class GeoPoint {
  @Prop({ required: true, enum: ['Point'], default: 'Point' })
  type!: 'Point';

  /**
   * [lng, lat]. Not [lat, lng].
   *
   * Validated explicitly. D-011 declined the 2dsphere index, and a 2dsphere index is what
   * would otherwise reject malformed GeoJSON at insert time for free -- so having declined
   * the index, we owe the validator (D-012). The failure it prevents is real and quiet:
   * [29.3759, 47.9774] instead of [47.9774, 29.3759] is a plausible typo that relocates a
   * venue by about 1,900 km, after which every honest visit there scores 0 and is rejected
   * -- and it reads as an engine bug until somebody checks a map.
   */
  @Prop({
    required: true,
    type: [Number],
    validate: {
      validator: (c: number[]) =>
        Array.isArray(c) &&
        c.length === 2 &&
        Number.isFinite(c[0]) && c[0]! >= -180 && c[0]! <= 180 &&
        Number.isFinite(c[1]) && c[1]! >= -90 && c[1]! <= 90,
      message: 'coordinates must be [lng, lat], lng in -180..180 and lat in -90..90',
    },
  })
  coordinates!: [number, number];
}
export const GeoPointSchema = SchemaFactory.createForClass(GeoPoint);

/**
 * A venue with its own geofence radius.
 *
 * Per-venue, never a global constant (CLAUDE.md rule 7): a kiosk and a hypermarket cannot
 * share a radius, and the indoor flag changes what accuracy the verification engine treats
 * as plausible.
 */
@Schema({ collection: 'venues', timestamps: true })
export class Venue {
  // Prefix of { clientOrgId, name }.
  @Prop({ required: true, type: String, ref: 'ClientOrg' })
  clientOrgId!: string;

  @Prop({ required: true, trim: true })
  name!: string;

  @Prop({ required: true, trim: true })
  address!: string;

  @Prop({ required: true, type: GeoPointSchema })
  location!: GeoPoint;

  /**
   * Geofence radius in metres.
   *
   * Bounded 25..500 on the schema, not just in the DTO. D-010: the spoof-adversary pass
   * pointed out that an unbounded radius is an attack -- a venue saved with radiusM 5000
   * auto-verifies anyone in the city, and it would look like a typo rather than a breach.
   * A schema-level bound means it cannot be reached through a seed script or a migration
   * either.
   */
  @Prop({ required: true, min: 25, max: 500 })
  radiusM!: number;

  /** Ring outside the fence counted as `near` rather than `outside`. */
  @Prop({ required: true, min: 0, max: 500, default: 50 })
  nearBufferM!: number;

  /** Indoor venues legitimately report far worse accuracy. The engine must not punish it. */
  @Prop({ required: true, default: false })
  indoor!: boolean;
}
export type VenueDocument = HydratedDocument<Venue>;
export const VenueSchema = SchemaFactory.createForClass(Venue);

// Convenience accessors so nothing outside this file has to know the GeoJSON axis order.
VenueSchema.virtual('lng').get(function (this: VenueDocument) {
  return this.location.coordinates[0];
});
VenueSchema.virtual('lat').get(function (this: VenueDocument) {
  return this.location.coordinates[1];
});

/**
 * NOTE ON 2dsphere: deliberately NOT indexed.
 *
 * The backlog listed a 2dsphere index here, and D-002 cited geospatial querying as a reason
 * to pick MongoDB. Neither survives contact with the design: rule 7 computes distance with
 * haversine in pure code, and rule 6 keeps the console off the ping collection, so there is
 * no query in this system that a 2dsphere index would serve. Adding an index nothing reads
 * is how a schema accumulates cargo.
 *
 * The data is stored as proper GeoJSON so the index is a one-line addition the moment a real
 * proximity query appears -- a "venues near me" picker in the admin form is the likely first
 * one. See D-011.
 */

// Unique, not merely indexed: this is the seed's upsert key, and without uniqueness two
// seeds racing both miss and both insert. D-012.
VenueSchema.index({ clientOrgId: 1, name: 1 }, { unique: true });
