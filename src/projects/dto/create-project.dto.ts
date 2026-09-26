import { IsOptional, IsString, IsUUID, MinLength } from "class-validator";

export class CreateProjectDto {
  @IsString()
  @MinLength(1)
  name: string;

  // Pre-auth artifact: last week's API (per the brief) took the acting
  // user straight from the request body. This field stays accepted by
  // validation through Assignment 2's W1 commit so the mass-assignment
  // check in W2 has something real to catch - after W2 it is read and
  // ignored, since @CurrentUser() is the only trusted source.
  @IsOptional()
  @IsUUID()
  ownerId?: string;
}
