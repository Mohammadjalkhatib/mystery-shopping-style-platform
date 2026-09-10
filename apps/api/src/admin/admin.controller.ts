import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import type { AuthUser } from '@msp/shared';
import { CurrentUser, Roles } from '../auth/auth.decorators.js';
import {
  AdminService,
  type ParticipantRow,
  type TaskRow,
  type VenueRow,
} from './admin.service.js';
import { CreateAssignmentDto } from './dto/create-assignment.dto.js';
import { CreateTaskDto } from './dto/create-task.dto.js';
import { CreateVenueDto } from './dto/create-venue.dto.js';
import { UpdateVenueDto } from './dto/update-venue.dto.js';

/**
 * Authoring. Venues, tasks and assignments -- the three things the seed used to be the only
 * way to create.
 *
 * No controller prefix, because the paths are `/venues`, `/tasks` and `/assignments`: these
 * are the resources themselves, not an admin view of them, and a `/admin` prefix would have
 * to be renamed the moment a participant needs to read a task. The ROLE is what restricts
 * them, not the URL.
 *
 * Every route carries @Roles: without it the route would be open to any authenticated user,
 * including a participant, since RolesGuard only restricts routes that ask to be restricted.
 * There is one test per boundary here for exactly that reason.
 */
@Controller()
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  /* ---------------------------------------------------------------- venues */

  @Roles('admin', 'business')
  @Post('venues')
  createVenue(@CurrentUser() user: AuthUser, @Body() dto: CreateVenueDto): Promise<VenueRow> {
    return this.admin.createVenue(user, dto);
  }

  @Roles('admin', 'business')
  @Get('venues')
  listVenues(@CurrentUser() user: AuthUser): Promise<VenueRow[]> {
    return this.admin.listVenues(user);
  }

  /**
   * Correct a venue. PATCH, not PUT: every field is optional and only what is sent changes.
   *
   * Safe against visits already under way because `venueSnapshot` pins the geofence at
   * `start` and both the evaluator and ping ingest read it (D-021).
   */
  @Roles('admin', 'business')
  @Patch('venues/:venueId')
  updateVenue(
    @Param('venueId') venueId: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateVenueDto,
  ): Promise<VenueRow> {
    return this.admin.updateVenue(user, venueId, dto);
  }

  /* ----------------------------------------------------------------- tasks */

  @Roles('admin', 'business')
  @Post('tasks')
  createTask(@CurrentUser() user: AuthUser, @Body() dto: CreateTaskDto): Promise<TaskRow> {
    return this.admin.createTask(user, dto);
  }

  @Roles('admin', 'business')
  @Get('tasks')
  listTasks(@CurrentUser() user: AuthUser): Promise<TaskRow[]> {
    return this.admin.listTasks(user);
  }

  /* ----------------------------------------------------------- assignments */

  @Roles('admin', 'business')
  @Post('assignments')
  createAssignment(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateAssignmentDto,
  ): Promise<{ assignmentId: string; sessionId: string; participantId: string }> {
    return this.admin.createAssignment(user, dto);
  }

  /**
   * The participant roster, so the assignment form has something to choose from.
   *
   * Scoped to one organisation since D-037: a business gets its own and may not ask for
   * another, an admin must say which. Before real accounts existed this returned the whole
   * demo roster, which was fine when there was one organisation and is a list of other
   * people's names as soon as there is more than one.
   */
  @Roles('admin', 'business')
  @Get('participants')
  listParticipants(
    @CurrentUser() user: AuthUser,
    @Query('clientOrgId') clientOrgId?: string,
  ): Promise<ParticipantRow[]> {
    return this.admin.listParticipants(user, clientOrgId);
  }
}
