import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Comment } from './comment.entity';

@Injectable()
export class CommentsService {
  constructor(
    @InjectRepository(Comment)
    private readonly commentsRepository: Repository<Comment>,
  ) {}

  create(taskId: string, authorId: string | undefined, content: string): Promise<Comment> {
    const comment = this.commentsRepository.create({ taskId, authorId, content });
    return this.commentsRepository.save(comment);
  }

  findAllByTask(taskId: string): Promise<Comment[]> {
    return this.commentsRepository.find({ where: { taskId } });
  }

  async findByIdOrThrow(id: string): Promise<Comment> {
    const comment = await this.commentsRepository.findOne({ where: { id } });
    if (!comment) {
      throw new NotFoundException('Comment not found');
    }
    return comment;
  }

  async remove(id: string): Promise<void> {
    await this.findByIdOrThrow(id);
    await this.commentsRepository.delete({ id });
  }
}
