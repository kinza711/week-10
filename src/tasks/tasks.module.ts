import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Task } from './task.entity';
import { TasksService } from './tasks.service';
import { ProjectTasksController, TasksController } from './tasks.controller';
import { AuthorizationModule } from '../authorization/authorization.module';

@Module({
  imports: [TypeOrmModule.forFeature([Task]), AuthorizationModule],
  controllers: [ProjectTasksController, TasksController],
  providers: [TasksService],
  exports: [TasksService],
})
export class TasksModule {}
