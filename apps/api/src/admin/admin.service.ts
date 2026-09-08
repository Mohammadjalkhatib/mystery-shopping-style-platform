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
import { ClientOrg, Venue } from '../db/schemas/org-venue.schema.js';
import { Assignment, Session, Task } from '../db/schemas/task-session.schema.js';
import type { CreateAssignmentDto } from './dto/create-assignment.dto.js';
import type { CreateTaskDto } from './dto/create-task.dto.js';
import type { CreateVenueDto } from './dto/create-venue.dto.js';

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
  ) {}

  /* ---------------------------------------------------------------- venues */

  async createVenue(user: AuthUser, dto: CreateVenueDto): Promise<VenueRow> {
    const clientOrgId = await this.resolveOrgForCreate(user, dto.clientOrgId);

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
