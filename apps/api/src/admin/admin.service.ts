import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import type { AuthUser } from '@msp/shared';
import type { Connection, Model } from 'mongoose';
import { DEMO_USERS } from '../auth/demo-users.js';
import { ParticipantService } from '../participant/participant.service.js';
import { checkCoordinatePrecision } from '../geo/precision.js';
import { ClientOrg, Venue } from '../db/schemas/org-venue.schema.js';
import { Assignment, Session, Task } from '../db/schemas/task-session.schema.js';
import type { CreateAssignmentDto } from './dto/create-assignment.dto.js';
import type { CreateTaskDto } from './dto/create-task.dto.js';
import type { CreateVenueDto } from './dto/create-venue.dto.js';
import type { UpdateVenueDto } from './dto/update-venue.dto.js';

export interface VenueRow {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  radiusM: number;
  nearBufferM: number;
  indoor: boolean;
}

export interface TaskRow {
  id: string;
  title: string;
  brief: string;
  venueId: string;
  venueName: string;
  expectedDwellSeconds: number;
  active: boolean;
  assignmentCount: number;
}

export interface ParticipantRow {
  id: string;
  displayName: string;
}

/** MongoDB duplicate key. Surfaces as a 409 rather than a 500. */
const DUPLICATE_KEY = 11000;
const isDuplicateKey = (e: unknown): boolean =>
  typeof e === 'object' && e !== null && (e as { code?: number }).code === DUPLICATE_KEY;

/**
 * Authoring: venues, tasks, assignments. The write side of what the seed used to be the only
 * source of.
 *
 * The tenancy rule is the one the console already reads under, applied to writes: an org is
 * never taken from the request body for a business user. It comes from the verified token, or
 * -- for a task and an assignment -- from the parent document that already carries it. D-017.
 */
@Injectable()
export class AdminService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(ClientOrg.name) private readonly orgs: Model<ClientOrg>,
    @InjectModel(Venue.name) private readonly venues: Model<Venue>,
    @InjectModel(Task.name) private readonly tasks: Model<Task>,
    @InjectModel(Assignment.name) private readonly assignments: Model<Assignment>,
    @InjectModel(Session.name) private readonly sessions: Model<Session>,
    private readonly participants: ParticipantService,
  ) {}

  /* ---------------------------------------------------------------- venues */

  async createVenue(user: AuthUser, dto: CreateVenueDto): Promise<VenueRow> {
    const clientOrgId = await this.resolveOrgForCreate(user, dto.clientOrgId);

    /**
     * A geofence is only as good as the centre it is measured from.
     *
     * `31.98, 35.83` with a 25 m radius was accepted once and produced a venue 4.8 km from
     * where the participant actually stood: two decimals locate a point to within ~557 m, so
     * that fence could not be entered from anywhere on earth. Every layer behaved correctly
     * and the visit was still, correctly, rejected -- which is the worst kind of failure,
     * because it looks like a broken engine. See D-020.
     */
    const precision = checkCoordinatePrecision(dto.lat, dto.lng, dto.radiusM);
    if (!precision.ok) {
      throw new BadRequestException(
        `Those coordinates give ${precision.decimals} decimal places, which locates the venue ` +
          `to about ${Math.round(precision.impliedM)} m. A ${dto.radiusM} m geofence needs the ` +
          `centre known to about ${Math.round(precision.requiredM)} m, so this fence could not ` +
          `be entered from anywhere. Use at least 4 decimal places, like 31.9399, 35.8486 — ` +
          `right-click the exact spot in Google Maps and copy the numbers it shows. A share ` +
          `link is not a coordinate.`,
      );
    }

    try {
      const venue = await this.venues.create({
        clientOrgId,
        name: dto.name,
        address: dto.address,
        // The ONE place lat/lng becomes [lng, lat]. See the GeoPoint schema comment for why
        // that conversion is allowed to exist in exactly one file.
        location: { type: 'Point', coordinates: [dto.lng, dto.lat] },
        radiusM: dto.radiusM,
        nearBufferM: dto.nearBufferM ?? 50,
        indoor: dto.indoor ?? false,
      });
      return this.venueRow(venue);
    } catch (e) {
      if (isDuplicateKey(e)) {
        throw new ConflictException(
          `A venue named "${dto.name}" already exists for this organisation`,
        );
      }
      throw e;
    }
  }

  async listVenues(user: AuthUser): Promise<VenueRow[]> {
    const rows = await this.venues.find(this.orgScope(user)).sort({ name: 1 }).lean();
    return rows.map((v) => this.venueRow(v as unknown as Venue & { _id: unknown }));
  }

  /**
   * Correct a venue.
   *
   * This exists because a venue was created at `31.98, 35.83` and there was no way to fix it
   * (D-020). Without an edit path a bad geofence is permanent, and the only workaround is a
   * second venue plus a second task plus new assignments -- which leaves the wrong one in the
   * list for ever.
   *
   * **Editing cannot change a verdict that has already been reached, and cannot corrupt a
   * visit in progress.** Both hold because of `venueSnapshot`: it is pinned at `start`, the
   * evaluator reads it (D-012), and as of D-021 ping ingest measures against it too. A visit
   * that has begun is therefore judged against the geofence as it was when it began, whatever
   * happens here afterwards. A `pending` session has no snapshot yet and will pick up the
   * corrected venue when it starts, which is the entire point.
   */
  async updateVenue(user: AuthUser, venueId: string, dto: UpdateVenueDto): Promise<VenueRow> {
    const venue = await this.venues
      .findById(venueId)
      .lean<
        | {
            _id: unknown;
            clientOrgId: string;
            location: { coordinates: [number, number] };
            radiusM: number;
          }
        | null
      >();
    if (!venue) throw new NotFoundException('Venue not found');
    this.assertCanWrite(user, venue.clientOrgId);

    // Half a coordinate is not a location, and the precision rule needs both halves.
    if ((dto.lat === undefined) !== (dto.lng === undefined)) {
      throw new BadRequestException('Send lat and lng together, or neither');
    }

    // The precision rule is checked against the RESULTING pair, because either half can move
    // independently of the other: widening a radius can rescue a coarse coordinate, and
    // tightening one can invalidate a coordinate that was previously fine.
    const nextLat = dto.lat ?? venue.location.coordinates[1];
    const nextLng = dto.lng ?? venue.location.coordinates[0];
    const nextRadius = dto.radiusM ?? venue.radiusM;
    const precision = checkCoordinatePrecision(nextLat, nextLng, nextRadius);
    if (!precision.ok) {
      throw new BadRequestException(
        `Those coordinates give ${precision.decimals} decimal places, which locates the venue ` +
          `to about ${Math.round(precision.impliedM)} m. A ${nextRadius} m geofence needs the ` +
          `centre known to about ${Math.round(precision.requiredM)} m, so this fence could not ` +
          `be entered from anywhere. Use at least 4 decimal places, like 31.9399, 35.8486.`,
      );
    }

    const $set: Record<string, unknown> = {};
    if (dto.name !== undefined) $set.name = dto.name;
    if (dto.address !== undefined) $set.address = dto.address;
    if (dto.lat !== undefined) $set.location = { type: 'Point', coordinates: [nextLng, nextLat] };
    if (dto.radiusM !== undefined) $set.radiusM = dto.radiusM;
    if (dto.nearBufferM !== undefined) $set.nearBufferM = dto.nearBufferM;
    if (dto.indoor !== undefined) $set.indoor = dto.indoor;
    if (Object.keys($set).length === 0) throw new BadRequestException('Nothing to update');

    try {
      const updated = await this.venues.findOneAndUpdate(
        { _id: venueId },
        { $set },
        { returnDocument: 'after' },
      );
      return this.venueRow(updated as unknown as Venue & { _id: unknown });
    } catch (e) {
      if (isDuplicateKey(e)) {
        throw new ConflictException(
          `A venue named "${dto.name}" already exists for this organisation`,
        );
      }
      throw e;
    }
  }

  /* ----------------------------------------------------------------- tasks */

  async createTask(user: AuthUser, dto: CreateTaskDto): Promise<TaskRow> {
    // The venue is the authority on the org, and reading it first is also what proves the
    // caller may write here at all.
    const venue = await this.venues
      .findById(dto.venueId)
      .lean<{ _id: unknown; clientOrgId: string; name: string } | null>();
    if (!venue) throw new NotFoundException('Venue not found');
    this.assertCanWrite(user, venue.clientOrgId);

    try {
      const task = await this.tasks.create({
        clientOrgId: venue.clientOrgId,
        venueId: String(venue._id),
        title: dto.title,
        brief: dto.brief,
        expectedDwellSeconds: dto.expectedDwellSeconds ?? 300,
        active: true,
      });
      return {
        id: String(task._id),
        title: task.title,
        brief: task.brief,
        venueId: task.venueId,
        venueName: venue.name,
        expectedDwellSeconds: task.expectedDwellSeconds,
        active: task.active,
        assignmentCount: 0,
      };
    } catch (e) {
      if (isDuplicateKey(e)) {
        throw new ConflictException(`A task titled "${dto.title}" already exists for this venue`);
      }
      throw e;
    }
  }

  async listTasks(user: AuthUser): Promise<TaskRow[]> {
    const tasks = await this.tasks
      .find(this.orgScope(user))
      .sort({ createdAt: -1 })
      .lean<
        {
          _id: unknown;
          title: string;
          brief: string;
          venueId: string;
          expectedDwellSeconds: number;
          active: boolean;
        }[]
      >();
    if (tasks.length === 0) return [];

    const ids = tasks.map((t) => String(t._id));
    const [venues, counts] = await Promise.all([
      this.venues
        .find({ _id: { $in: [...new Set(tasks.map((t) => t.venueId))] } })
        .select({ name: 1 })
        .lean<{ _id: unknown; name: string }[]>(),
      // One grouped query rather than a count per row.
      this.assignments.aggregate<{ _id: string; n: number }>([
        { $match: { taskId: { $in: ids } } },
        { $group: { _id: '$taskId', n: { $sum: 1 } } },
      ]),
    ]);

    const venueName = new Map(venues.map((v) => [String(v._id), v.name]));
    const countFor = new Map(counts.map((c) => [c._id, c.n]));

    return tasks.map((t) => ({
      id: String(t._id),
      title: t.title,
      brief: t.brief,
      venueId: t.venueId,
      venueName: venueName.get(t.venueId) ?? 'Unknown venue',
      expectedDwellSeconds: t.expectedDwellSeconds,
      active: t.active,
      assignmentCount: countFor.get(String(t._id)) ?? 0,
    }));
  }

  /* ----------------------------------------------------------- assignments */

  /**
   * Assign a task and open the pending session for it, in one transaction (D-018).
   *
   * `/sessions/mine` reads sessions, not assignments, so an assignment written without its
   * session is invisible to the participant it was created for -- present in the database and
   * unreachable from the product. The seed has always written the pair together; this is that
   * same pairing behind an endpoint.
   */
  async createAssignment(
    user: AuthUser,
    dto: CreateAssignmentDto,
  ): Promise<{ assignmentId: string; sessionId: string; participantId: string }> {
    const task = await this.tasks
      .findById(dto.taskId)
      .lean<{ _id: unknown; clientOrgId: string; venueId: string; active: boolean } | null>();
    if (!task) throw new NotFoundException('Task not found');
    this.assertCanWrite(user, task.clientOrgId);
    if (!task.active) throw new BadRequestException('That task is not active');

    // Participants are a fixed demo roster (D-008), so this is a membership check rather than
    // a user lookup. It still matters: without it a task can be assigned to `u-admin`, or to
    // a participant id that will never sign in, and the assignment looks correct forever.
    const participant = DEMO_USERS.find((u) => u.id === dto.participantId);
    if (!participant || participant.role !== 'participant') {
      throw new BadRequestException(`${dto.participantId} is not a participant`);
    }

    const now = new Date();
    const dbSession = await this.connection.startSession();
    let assignmentId = '';
    let sessionId = '';

    try {
      await dbSession.withTransaction(async () => {
        const [assignment] = await this.assignments.create(
          [
            {
              taskId: String(task._id),
              participantId: dto.participantId,
              clientOrgId: task.clientOrgId,
              consentedAt: null,
              consentVersion: null,
            },
          ],
          { session: dbSession },
        );
        assignmentId = String(assignment!._id);

        // Mirrors the seed exactly. Every timestamp is a server clock reading (rule 2), and
        // the session starts `pending` because the state machine owns every move after this
        // one (rule 5).
        const [session] = await this.sessions.create(
          [
            {
              assignmentId,
              participantId: dto.participantId,
              clientOrgId: task.clientOrgId,
              venueId: task.venueId,
              pingCount: 0,
              state: 'pending',
              createdAtServer: now,
              lastSeenAt: now,
            },
          ],
          { session: dbSession },
        );
        sessionId = String(session!._id);
      });
    } catch (e) {
      if (isDuplicateKey(e)) {
        throw new ConflictException('That participant already has this task');
      }
      throw e;
    } finally {
      await dbSession.endSession();
    }

    /**
     * Tell the participant, AFTER the transaction and outside it.
     *
     * Fire-and-forget for the same reason `EvaluatorRunner.kick()` is (D-004): a notification
     * that cannot be delivered must not be able to fail the write that caused it. The
     * assignment is committed at this point; if the push is lost, the participant still sees
     * it the next time they open the app, because the list is the truth and the stream is an
     * optimisation (D-035).
     */
    void this.participants.announceAssignment(sessionId).catch(() => undefined);

    return { assignmentId, sessionId, participantId: dto.participantId };
  }

  /** The demo roster, so the assignment form has something to choose from. */
  listParticipants(): ParticipantRow[] {
    return DEMO_USERS.filter((u) => u.role === 'participant').map((u) => ({
      id: u.id,
      displayName: u.displayName,
    }));
  }

  /* --------------------------------------------------------------- tenancy */

  /** Admin sees and writes every org; a business user is pinned to exactly one. */
  private orgScope(user: AuthUser): Record<string, unknown> {
    return user.role === 'admin' ? {} : { clientOrgId: user.clientOrgId };
  }

  /**
   * Which org a NEW root document belongs to.
   *
   * A business user may not name one: their token already says which org they are, and a body
   * field that could disagree with it is the tenancy boundary written as a suggestion (rule 2,
   * D-017). An admin has no org of their own, so they must name one, and it must exist --
   * otherwise a typo silently creates a venue in an organisation nobody can read.
   */
  private async resolveOrgForCreate(user: AuthUser, bodyOrgId?: string): Promise<string> {
    if (user.role === 'admin') {
      if (!bodyOrgId) {
        throw new BadRequestException('clientOrgId is required: an admin has no organisation');
      }
      const exists = await this.orgs.exists({ _id: bodyOrgId });
      if (!exists) throw new NotFoundException(`No such organisation: ${bodyOrgId}`);
      return bodyOrgId;
    }

    if (bodyOrgId && bodyOrgId !== user.clientOrgId) {
      throw new ForbiddenException('clientOrgId is taken from your account and cannot be set');
    }
    if (!user.clientOrgId) {
      throw new ForbiddenException('Your account is not attached to an organisation');
    }
    return user.clientOrgId;
  }

  /** May this caller write into this org? */
  private assertCanWrite(user: AuthUser, clientOrgId: string): void {
    if (user.role === 'admin') return;
    if (user.clientOrgId !== clientOrgId) {
      throw new ForbiddenException('That resource belongs to another organisation');
    }
  }

  private venueRow(v: Venue & { _id: unknown }): VenueRow {
    return {
      id: String(v._id),
      name: v.name,
      address: v.address,
      lng: v.location.coordinates[0],
      lat: v.location.coordinates[1],
      radiusM: v.radiusM,
      nearBufferM: v.nearBufferM,
      indoor: v.indoor,
    };
  }
}
