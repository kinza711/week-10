import { SetMetadata } from '@nestjs/common';
import { ProjectRole } from '../enums/project-role.enum';

export const ROLES_KEY = 'roles';

/**
 * Problem C1. Roles are data, read from project_members at request time -
 * not a global flag on the user. Changing a membership row must change
 * access with no code change and no restart.
 */
export const Roles = (...roles: ProjectRole[]) => SetMetadata(ROLES_KEY, roles);
