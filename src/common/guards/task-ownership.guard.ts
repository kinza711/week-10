import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { isUUID } from 'class-validator';
import { Task } from '../../tasks/task.entity';
import { ProjectRole } from '../enums/project-role.enum';

/**
 * Challenge X1. "A member may edit tasks" and "a member may edit
 * anyone's task" are not the same rule. This runs after RolesGuard (see
 * the @UseGuards order on TasksController.update) and reuses the
 * membership it already attached to the request - owner/admin still
 * override, since the project-level role already grants that. Below
 * owner/admin, only the task's creator or assignee may edit it.
 */
@Injectable()
export class TaskOwnershipGuard implements CanActivate {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;
    // Set by RolesGuard, which must run before this guard on the route.
    const membership = request.projectMembership;

    if (
      membership?.role === ProjectRole.OWNER ||
      membership?.role === ProjectRole.ADMIN
    ) {
      return true;
    }

    const taskId = request.params.id;
    // Problem C3, same reasoning as RolesGuard: this guard's own
    // database query never goes through the controller's ParseUUIDPipe,
    // since guards run first. In the current wiring RolesGuard always
    // runs before this guard on the one route it's applied to and would
    // already have rejected a malformed id - this check is defense in
    // depth for if that ever changes.
    if (!isUUID(taskId)) {
      throw new BadRequestException('Invalid task id');
    }

    const task = await this.dataSource.getRepository(Task).findOne({
      where: { id: taskId },
    });
    if (!task) {
      throw new NotFoundException('Task not found');
    }

    if (task.createdBy === user.id || task.assigneeId === user.id) {
      return true;
    }

    throw new ForbiddenException(
      'Only the task creator, its assignee, or a project owner/admin may edit it',
    );
  }
}
