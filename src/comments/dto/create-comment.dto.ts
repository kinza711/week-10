import { IsOptional, IsString, IsUUID, MinLength } from 'class-validator';

export class CreateCommentDto {
  @IsString()
  @MinLength(1)
  content: string;

  // Pre-auth artifact, same reasoning as CreateProjectDto.ownerId.
  @IsOptional()
  @IsUUID()
  authorId?: string;
}
