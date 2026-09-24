import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Task, TaskStatus } from "./task.entity";
import { FindOptionsWhere } from "typeorm"; // add if not already imported

export interface CreateTaskInput {
  projectId: string;
  title: string;
  description?: string;
  assigneeId?: string;
  createdBy: string | undefined;
}

export interface UpdateTaskInput {
  title?: string;
  description?: string;
  status?: Task["status"];
  assigneeId?: string;
}

@Injectable()
export class TasksService {
  constructor(
    @InjectRepository(Task)
    private readonly tasksRepository: Repository<Task>,
  ) {}

  create(input: CreateTaskInput): Promise<Task> {
    const task = this.tasksRepository.create({
      projectId: input.projectId,
      title: input.title,
      description: input.description ?? null,
      assigneeId: input.assigneeId ?? null,
      createdBy: input.createdBy,
    });
    return this.tasksRepository.save(task);
  }

  findAllByProject(projectId: string, status?: string) {
    const where: FindOptionsWhere<Task> = { projectId };
    if (status) {
      where.status = status as TaskStatus;
    }
    return this.tasksRepository.find({ where });
  }

  async findByIdOrThrow(id: string): Promise<Task> {
    const task = await this.tasksRepository.findOne({ where: { id } });
    if (!task) {
      throw new NotFoundException("Task not found");
    }
    return task;
  }

  async update(id: string, input: UpdateTaskInput): Promise<Task> {
    const task = await this.findByIdOrThrow(id);
    Object.assign(task, input);
    return this.tasksRepository.save(task);
  }

  async remove(id: string): Promise<void> {
    await this.findByIdOrThrow(id);
    await this.tasksRepository.delete({ id });
  }
}
