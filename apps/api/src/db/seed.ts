import mongoose from 'mongoose';
import { DEMO_CLIENT_ORG_ID } from '../auth/demo-users.js';
import { ClientOrgSchema, VenueSchema } from './schemas/org-venue.schema.js';
import { AssignmentSchema, SessionSchema, TaskSchema } from './schemas/task-session.schema.js';

/**
 * Seed: one client org, two Kuwait venues (one indoor, one outdoor), one task each, and
 * assignments for the demo participants.
 *
 * Idempotent -- safe to run repeatedly against the same database, which matters because
 * `docker compose up` runs it on every start. Keyed on natural identifiers, never on _id.
 *
 * Coordinates are the real reference points from the geo-fixtures skill, so a reviewer can
 * check them against a map and the demo data looks like the product rather than a tutorial.
 */

export const SEED_ORG_SLUG = 'alfa-retail';

const VENUES = [
  {
    name: 'Alfa Market — Kuwait City',
    address: 'Al Soor Street, Kuwait City',
    // KUWAIT_CITY_CENTRE. Outdoor: tight radius, good accuracy expected.
    lng: 47.9774,
    lat: 29.3759,
    radiusM: 75,
    nearBufferM: 50,
    indoor: false,
  },
  {
    name: 'Alfa Store — The Avenues',
    address: 'The Avenues Mall, Al Rai',
    // AVENUES_MALL. Indoor: wider radius because the fix degrades and the building is big.
    lng: 47.9383,
    lat: 29.3028,
    radiusM: 120,
    nearBufferM: 80,
    indoor: true,
  },
];

/** Matches the demo accounts in apps/api/src/auth/demo-users.ts (D-008). */
const PARTICIPANT_IDS = Array.from({ length: 10 }, (_, i) => `u-participant-${i + 1}`);

export async function seed(uri: string): Promise<void> {
  const conn = await mongoose.createConnection(uri).asPromise();

  const Org = conn.model('ClientOrg', ClientOrgSchema);
  const Venue = conn.model('Venue', VenueSchema);
  const Task = conn.model('Task', TaskSchema);
  const Assignment = conn.model('Assignment', AssignmentSchema);
  const Session = conn.model('Session', SessionSchema);

  /**
   * The org is seeded with a DETERMINISTIC _id that matches what the demo accounts carry.
   *
   * Previously this took whatever ObjectId Mongo generated, while demo-users.ts carried the
   * literal 'org-alfa-retail'. The tenancy filter compares the two, so it never matched and
   * the console was empty for every seeded visit. See D-014.
   */
  await Org.findOneAndUpdate(
    { _id: DEMO_CLIENT_ORG_ID },
    { $setOnInsert: { _id: DEMO_CLIENT_ORG_ID, name: 'Alfa Retail', slug: SEED_ORG_SLUG } },
    { upsert: true, returnDocument: 'after' },
  );
  const clientOrgId = DEMO_CLIENT_ORG_ID;

  let venueCount = 0;
  let taskCount = 0;
  let assignmentCount = 0;

  for (const v of VENUES) {
    const venue = await Venue.findOneAndUpdate(
      { clientOrgId, name: v.name },
      {
        $setOnInsert: {
          clientOrgId,
          name: v.name,
          address: v.address,
          location: { type: 'Point', coordinates: [v.lng, v.lat] },
          radiusM: v.radiusM,
          nearBufferM: v.nearBufferM,
          indoor: v.indoor,
        },
      },
      { upsert: true, returnDocument: 'after' },
    );
    venueCount++;

    const title = `Customer experience check — ${v.name}`;
    const task = await Task.findOneAndUpdate(
      { clientOrgId, venueId: String(venue._id), title },
      {
        $setOnInsert: {
          clientOrgId,
          venueId: String(venue._id),
          title,
          brief:
            'Visit as an ordinary customer. Note greeting time, staff helpfulness, queue ' +
            'length and store cleanliness. Do not identify yourself.',
          expectedDwellSeconds: 300,
          active: true,
        },
      },
      { upsert: true, returnDocument: 'after' },
    );
    taskCount++;

    // Five participants per venue, so both an indoor and an outdoor visit are demoable.
    const slice = v.indoor ? PARTICIPANT_IDS.slice(5) : PARTICIPANT_IDS.slice(0, 5);
    for (const participantId of slice) {
      const assignment = await Assignment.findOneAndUpdate(
        { taskId: String(task._id), participantId },
        { $setOnInsert: { taskId: String(task._id), participantId, clientOrgId } },
        { upsert: true, returnDocument: 'after' },
      );
      assignmentCount++;

      /**
       * A pending session per assignment, so the participant app has something to open.
       *
       * The clocks are $set on EVERY run, not $setOnInsert.
       *
       * With $setOnInsert they were pinned to first-boot time, and dueEvent() reaps a
       * pending session off its idle clock after SESSION_ABANDON_AFTER_SECONDS (900).
       * Fifteen minutes after the first `docker compose up` all ten demo sessions became
       * `abandoned` -- terminal -- and re-running the seed could not revive them because
       * the insert never fired again. The demo was then permanently empty and the only
       * recovery was `docker compose down -v`. Caught by the schema-reviewer pass, D-012.
       *
       * Re-seeding is therefore also the documented way to reset a stale demo.
       */
      const now = new Date();
      await Session.findOneAndUpdate(
        { assignmentId: String(assignment._id) },
        {
          $setOnInsert: {
            assignmentId: String(assignment._id),
            participantId,
            clientOrgId,
            venueId: String(venue._id),
            pingCount: 0,
          },
          // Reset the clocks and the state so the demo is always openable.
          $set: { state: 'pending', createdAtServer: now, lastSeenAt: now },
        },
        { upsert: true, returnDocument: 'after' },
      );
    }
  }

  // eslint-disable-next-line no-console
  console.log(
    `[seed] org=${SEED_ORG_SLUG} venues=${venueCount} tasks=${taskCount} assignments=${assignmentCount} (idempotent)`,
  );
  await conn.close();
}

// Run directly: `npm run db:seed`
const invokedDirectly = process.argv[1]?.replace(/\\/g, '/').endsWith('/db/seed.js');
if (invokedDirectly) {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    // eslint-disable-next-line no-console
    console.error('[seed] MONGO_URI is not set. Copy .env.example to .env first.');
    process.exit(1);
  }
  seed(uri).catch((e: unknown) => {
    // eslint-disable-next-line no-console
    console.error('[seed] failed:', e);
    process.exit(1);
  });
}
