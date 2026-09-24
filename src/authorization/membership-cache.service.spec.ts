import { MembershipCacheService } from './membership-cache.service';
import { ProjectMember } from '../projects/project-member.entity';
import { ProjectRole } from '../common/enums/project-role.enum';

describe('MembershipCacheService (Challenge X3)', () => {
  const originalTtl = process.env.MEMBERSHIP_CACHE_TTL_MS;

  afterEach(() => {
    process.env.MEMBERSHIP_CACHE_TTL_MS = originalTtl;
  });

  const makeMember = (): ProjectMember =>
    ({
      userId: 'user-1',
      projectId: 'project-1',
      role: ProjectRole.MEMBER,
      createdAt: new Date(),
    } as ProjectMember);

  it('returns a hit for a value just set', () => {
    const cache = new MembershipCacheService();
    const member = makeMember();

    cache.set('user-1', 'project-1', member);
    const result = cache.get('user-1', 'project-1');

    expect(result).toEqual({ hit: true, member });
  });

  it('is a miss for a (user, project) pair never set', () => {
    const cache = new MembershipCacheService();
    expect(cache.get('nobody', 'nowhere')).toEqual({ hit: false });
  });

  it('caches a null result too (non-member), not just a real membership', () => {
    const cache = new MembershipCacheService();
    cache.set('user-1', 'project-1', null);
    expect(cache.get('user-1', 'project-1')).toEqual({ hit: true, member: null });
  });

  it('expires after the configured TTL', async () => {
    process.env.MEMBERSHIP_CACHE_TTL_MS = '20';
    const cache = new MembershipCacheService();
    cache.set('user-1', 'project-1', makeMember());

    expect(cache.get('user-1', 'project-1').hit).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(cache.get('user-1', 'project-1').hit).toBe(false);
  });

  it('invalidate() clears one (user, project) pair immediately, before TTL', () => {
    process.env.MEMBERSHIP_CACHE_TTL_MS = '60000';
    const cache = new MembershipCacheService();
    cache.set('user-1', 'project-1', makeMember());
    cache.set('user-2', 'project-1', makeMember());

    cache.invalidate('user-1', 'project-1');

    expect(cache.get('user-1', 'project-1').hit).toBe(false);
    // A different user's entry for the same project is untouched.
    expect(cache.get('user-2', 'project-1').hit).toBe(true);
  });

  it('invalidateProject() clears every user cached for that project, leaves others alone', () => {
    const cache = new MembershipCacheService();
    cache.set('user-1', 'project-1', makeMember());
    cache.set('user-2', 'project-1', makeMember());
    cache.set('user-1', 'project-2', makeMember());

    cache.invalidateProject('project-1');

    expect(cache.get('user-1', 'project-1').hit).toBe(false);
    expect(cache.get('user-2', 'project-1').hit).toBe(false);
    // project-2's entry survives - invalidateProject is scoped.
    expect(cache.get('user-1', 'project-2').hit).toBe(true);
  });
});
