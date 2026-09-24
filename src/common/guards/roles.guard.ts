import {
  ForbiddenException,
  Injectable,
  CanActivate,
  ExecutionContext,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { isUUID } from 'class-validator';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { RESOURCE_KEY, ResourceRef } from '../decorators/resource.decorator';
import { ProjectMember } from '../../projects/project-member.entity';
import { Task } from '../../tasks/task.entity';
import { Comment } from '../../comments/comment.entity';
import { ProjectRole } from '../enums/project-role.enum';
import { MembershipCacheService } from '../../authorization/membership-cache.service';

/**
 * Problems C1 and C3. Reads the caller's role from project_members for
 * the specific project the request touches - never "is this user a
 * member somewhere", always "is this user a member here". A role on
 * project A grants nothing on project B, because this guard never looks
 * at any project except the one the resource being touched belongs to.
 *
 * Uses the DataSource directly (genuinely global, provided once by
 * TypeOrmModule.forRoot) rather than per-entity repositories injected
 * via TypeOrmModule.forFeature. Task and Comment are also registered
 * with forFeature in their own feature modules, and resolving the same
 * repository token through a class-referenced guard across module
 * boundaries is exactly the kind of cross-module wiring that's fragile
 * to get right - DataSource sidesteps it entirely.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly membershipCache: MembershipCacheService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredRoles = this.reflector.getAllAndOverride<ProjectRole[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    // No @Roles() on this route - it isn't project-role gated.
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const resource = this.reflector.getAllAndOverride<ResourceRef>(
      RESOURCE_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!resource) {
      // A route declared @Roles() without @Resource() is a programming
      // error, not a caller error - fail loudly rather than silently
      // allowing everyone through.
      throw new Error(
        `RolesGuard: route has @Roles() but no @Resource() to resolve a project id`,
      );
    }

    const request = context.switchToHttp().getRequest();
    // JwtAuthGuard must run before this guard (Problem C4) and attaches
    // req.user - if it's missing here, guard ordering is wrong.
    const user = request.user;

    const projectId = await this.resolveProjectId(resource, request.params);
    if (!projectId) {
      throw new NotFoundException('Resource not found');
    }

    const membership = await this.getMembership(user.id, projectId);

    // Deliberately 403, not 404, even for a non-member: it tells the
    // caller the resource exists but they may not act on it, which is
    // consistent with every other role failure in this guard. A 404
    // here would hide that inconsistently only for non-members.
    if (!membership || !requiredRoles.includes(membership.role)) {
      throw new ForbiddenException(
        'You do not have the required role on this project',
      );
    }

    request.projectMembership = membership;
    return true;
  }

  private async getMembership(
    userId: string,
    projectId: string,
  ): Promise<ProjectMember | null> {
    const cached = this.membershipCache.get(userId, projectId);
    if (cached.hit) {
      return cached.member;
    }

    const membership = await this.dataSource
      .getRepository(ProjectMember)
      .findOne({ where: { userId, projectId } });
    this.membershipCache.set(userId, projectId, membership);
    return membership;
  }

  private async resolveProjectId(
    resource: ResourceRef,
    params: Record<string, string>,
  ): Promise<string | null> {
    const id = params[resource.param];
    if (!id) {
      return null;
    }

    // Problem C3. Guards run before Nest's pipes in the request
    // lifecycle, so a ParseUUIDPipe on the controller method's own
    // parameter (still applied - see the controllers - as the last
    // line of defense) never actually protects this guard's own
    // database queries below, which use the raw param value directly.
    // Reject a malformed id here, before it reaches the database,
    // rather than letting a raw driver error become an unhandled 500.
    if (!isUUID(id)) {
      throw new BadRequestException(`Invalid ${resource.type} id`);
    }

    switch (resource.type) {
      case 'project':
        return id;

      case 'task': {
        const task = await this.dataSource
          .getRepository(Task)
          .findOne({ where: { id } });
        return task?.projectId ?? null;
      }

      case 'comment': {
        const comment = await this.dataSource
          .getRepository(Comment)
          .findOne({ where: { id } });
        if (!comment) {
          return null;
        }
        const task = await this.dataSource
          .getRepository(Task)
          .findOne({ where: { id: comment.taskId } });
        return task?.projectId ?? null;
      }
    }
  }
}
