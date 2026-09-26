import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Resource } from '../common/decorators/resource.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/jwt.strategy';
import { ProjectRole } from '../common/enums/project-role.enum';

// Problem C4: JwtAuthGuard runs before RolesGuard - you cannot look up a
// role for a user you haven't identified yet, and the wrong order turns
// a missing token into a confusing 403 instead of 401. Since Challenge
// X2, JwtAuthGuard is global (APP_GUARD in auth.module.ts) and Nest
// always runs global guards before controller-level ones, so that
// ordering holds automatically - RolesGuard here only ever sees an
// already-authenticated request.
@UseGuards(RolesGuard)
@Controller('projects')
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Post()
  // No @Roles() here: creating a project has no project to check a role
  // against yet. Any authenticated user may create one and becomes its
  // owner (see ProjectsService.create).
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateProjectDto) {
    return this.projectsService.create(user.id, dto.name);
  }

  @Get(':id')
  @Roles(ProjectRole.OWNER, ProjectRole.ADMIN, ProjectRole.MEMBER, ProjectRole.VIEWER)
  @Resource('project', 'id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.projectsService.findByIdOrThrow(id);
  }

  @Patch(':id')
  // Renaming/managing the project itself is owner/admin territory - a
  // member's stated scope is tasks and comments, not the project entity.
  @Roles(ProjectRole.OWNER, ProjectRole.ADMIN)
  @Resource('project', 'id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateProjectDto) {
    return this.projectsService.update(id, dto.name);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  // Problem C2: only owner or admin may delete a project.
  @Roles(ProjectRole.OWNER, ProjectRole.ADMIN)
  @Resource('project', 'id')
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.projectsService.remove(id);
  }
}
