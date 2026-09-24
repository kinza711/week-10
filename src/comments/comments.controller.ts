import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CommentsService } from './comments.service';
import { CreateCommentDto } from './dto/create-comment.dto';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Resource } from '../common/decorators/resource.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/jwt.strategy';
import { ProjectRole } from '../common/enums/project-role.enum';

@UseGuards(RolesGuard)
@Controller('tasks/:taskId/comments')
export class TaskCommentsController {
  constructor(private readonly commentsService: CommentsService) {}

  @Post()
  @Roles(ProjectRole.OWNER, ProjectRole.ADMIN, ProjectRole.MEMBER)
  @Resource('task', 'taskId')
  create(
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Body() dto: CreateCommentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.commentsService.create(taskId, user.id, dto.content);
  }

  @Get()
  @Roles(ProjectRole.OWNER, ProjectRole.ADMIN, ProjectRole.MEMBER, ProjectRole.VIEWER)
  @Resource('task', 'taskId')
  findAll(@Param('taskId', ParseUUIDPipe) taskId: string) {
    return this.commentsService.findAllByTask(taskId);
  }
}

@UseGuards(RolesGuard)
@Controller('comments')
export class CommentsController {
  constructor(private readonly commentsService: CommentsService) {}

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  // This route only carries a comment id - the guard loads the comment,
  // then its task, to find the project to check membership against.
  @Roles(ProjectRole.OWNER, ProjectRole.ADMIN, ProjectRole.MEMBER)
  @Resource('comment', 'id')
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.commentsService.remove(id);
  }
}
