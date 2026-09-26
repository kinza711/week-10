import { Global, Module } from '@nestjs/common';
import { RolesGuard } from '../common/guards/roles.guard';
import { TaskOwnershipGuard } from '../common/guards/task-ownership.guard';
import { MembershipCacheService } from './membership-cache.service';

/**
 * RolesGuard and TaskOwnershipGuard need to read project_members/tasks/
 * comments across three different feature modules. Both resolve those
 * via the DataSource directly (see the guards themselves) rather than
 * per-module repositories, so this module just needs to provide the
 * guards themselves, globally, once. MembershipCacheService (Challenge
 * X3) lives here too, as a singleton shared by every request.
 */
@Global()
@Module({
  providers: [RolesGuard, TaskOwnershipGuard, MembershipCacheService],
  exports: [RolesGuard, TaskOwnershipGuard, MembershipCacheService],
})
export class AuthorizationModule {}
