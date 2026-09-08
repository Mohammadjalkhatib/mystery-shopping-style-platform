import { Body, Controller, Get, Post } from '@nestjs/common';
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
   * The demo participant roster, so the assignment form has something to choose from.
   *
   * Not `/auth/demo-credentials`: that is public and exists to hand a reviewer a password.
   * This one is role-guarded and returns ids, which is what an assignment actually needs.
   */
  @Roles('admin', 'business')
  @Get('participants')
  listParticipants(): ParticipantRow[] {
    return this.admin.listParticipants();
  }
}
