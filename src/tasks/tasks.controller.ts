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
  Query,
  Post,
  UseGuards,
} from "@nestjs/common";
import { TasksService } from "./tasks.service";
import { CreateTaskDto } from "./dto/create-task.dto";
import { UpdateTaskDto } from "./dto/update-task.dto";
import { RolesGuard } from "../common/guards/roles.guard";
import { TaskOwnershipGuard } from "../common/guards/task-ownership.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { Resource } from "../common/decorators/resource.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { AuthenticatedUser } from "../auth/jwt.strategy";
import { ProjectRole } from "../common/enums/project-role.enum";

@UseGuards(RolesGuard)
@Controller("projects/:projectId/tasks")
export class ProjectTasksController {
  constructor(private readonly tasksService: TasksService) {}

  @Post()
  // A viewer creating a task gets 403; member/admin/owner succeed.
  @Roles(ProjectRole.OWNER, ProjectRole.ADMIN, ProjectRole.MEMBER)
  @Resource("project", "projectId")
  create(
    @Param("projectId", ParseUUIDPipe) projectId: string,
    @Body() dto: CreateTaskDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tasksService.create({
      projectId,
      title: dto.title,
      description: dto.description,
      assigneeId: dto.assigneeId,
      createdBy: user.id,
    });
  }

  @Get()
  @Roles(
    ProjectRole.OWNER,
    ProjectRole.ADMIN,
    ProjectRole.MEMBER,
    ProjectRole.VIEWER,
  )
  @Resource("project", "projectId")
  findAll(
    @Param("projectId", ParseUUIDPipe) projectId: string,
    @Query("status") status?: string,
  ) {
    return this.tasksService.findAllByProject(projectId, status);
  }
}

@UseGuards(RolesGuard)
@Controller("tasks")
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  @Get(":id")
  // Problem C3: this route only carries a task id, so the guard loads
  // the task first to find its project before checking membership -
  // a role on a different project must grant nothing here.
  @Roles(
    ProjectRole.OWNER,
    ProjectRole.ADMIN,
    ProjectRole.MEMBER,
    ProjectRole.VIEWER,
  )
  @Resource("task", "id")
  findOne(@Param("id", ParseUUIDPipe) id: string) {
    return this.tasksService.findByIdOrThrow(id);
  }

  @Patch(":id")
  // Problem C1's role check: member/admin/owner only, viewer forbidden.
  @Roles(ProjectRole.OWNER, ProjectRole.ADMIN, ProjectRole.MEMBER)
  @Resource("task", "id")
  // Challenge X1's ownership check runs after: below owner/admin, only
  // the task's creator or assignee may actually edit it.
  @UseGuards(TaskOwnershipGuard)
  update(@Param("id", ParseUUIDPipe) id: string, @Body() dto: UpdateTaskDto) {
    return this.tasksService.update(id, dto);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(ProjectRole.OWNER, ProjectRole.ADMIN, ProjectRole.MEMBER)
  @Resource("task", "id")
  async remove(@Param("id", ParseUUIDPipe) id: string): Promise<void> {
    await this.tasksService.remove(id);
  }
}
