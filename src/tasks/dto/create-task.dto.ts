import { IsOptional, IsString, IsUUID, MinLength } from 'class-validator';

export class CreateTaskDto {
  @IsString()
  @MinLength(1)
  title: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsUUID()
  assigneeId?: string;

  // Pre-auth artifact, same reasoning as CreateProjectDto.ownerId - read
  // and ignored once @CurrentUser() lands in Problem W2.
  @IsOptional()
  @IsUUID()
  createdBy?: string;
}
