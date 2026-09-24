import { SetMetadata } from '@nestjs/common';

export type ResourceType = 'project' | 'task' | 'comment';

export interface ResourceRef {
  type: ResourceType;
  /** Name of the route param holding this resource's id. */
  param: string;
}

export const RESOURCE_KEY = 'resource';

/**
 * Problem C1's guard needs the project id for the request, and it can
 * come from different places depending on the route: the route param is
 * the project id directly ('project'), or it belongs to a task/comment
 * that has to be loaded first to find its project ('task' / 'comment').
 * Each route says explicitly which case it is, rather than the guard
 * guessing from the URL shape.
 */
export const Resource = (type: ResourceType, param: string) =>
  SetMetadata(RESOURCE_KEY, { type, param } satisfies ResourceRef);
