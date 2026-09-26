import { Injectable } from '@nestjs/common';
import { ProjectMember } from '../projects/project-member.entity';

interface CacheEntry {
  member: ProjectMember | null;
  expiresAt: number;
}

/**
 * Challenge X3. RolesGuard hits project_members on every protected
 * request - the most repeated query in the app. This caches that lookup
 * per (user, project) pair with a short TTL, and exposes explicit
 * invalidation so a membership change takes effect immediately rather
 * than waiting out the TTL.
 *
 * Worst-case staleness window: DEFAULT_TTL_MS (10s by default, override
 * via MEMBERSHIP_CACHE_TTL_MS) - the longest a revoked or changed
 * membership could still be honored if the code path that changed it
 * ever fails to call invalidate(). Every current mutation path in this
 * PR (ProjectsService.create / remove) does call it; see README.
 *
 * In-memory and per-process: correct for this single-instance deployment.
 * A multi-instance deployment would need a shared cache (Redis) instead,
 * since invalidation on one instance wouldn't reach the others.
 */
@Injectable()
export class MembershipCacheService {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly ttlMs = Number(process.env.MEMBERSHIP_CACHE_TTL_MS ?? 10_000);

  private key(userId: string, projectId: string): string {
    return `${userId}:${projectId}`;
  }

  get(userId: string, projectId: string): { hit: true; member: ProjectMember | null } | { hit: false } {
    const entry = this.cache.get(this.key(userId, projectId));
    if (!entry || entry.expiresAt < Date.now()) {
      return { hit: false };
    }
    return { hit: true, member: entry.member };
  }

  set(userId: string, projectId: string, member: ProjectMember | null): void {
    this.cache.set(this.key(userId, projectId), {
      member,
      expiresAt: Date.now() + this.ttlMs,
    });
  }

  /** Call whenever one user's membership on one project changes. */
  invalidate(userId: string, projectId: string): void {
    this.cache.delete(this.key(userId, projectId));
  }

  /** Call whenever a project's membership set changes in bulk (e.g. the project itself is deleted). */
  invalidateProject(projectId: string): void {
    for (const key of this.cache.keys()) {
      if (key.endsWith(`:${projectId}`)) {
        this.cache.delete(key);
      }
    }
  }
}
