import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { getDataSourceToken } from '@nestjs/typeorm';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { RolesGuard } from './roles.guard';
import { MembershipCacheService } from '../../authorization/membership-cache.service';
import { ProjectRole } from '../enums/project-role.enum';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { RESOURCE_KEY } from '../decorators/resource.decorator';

function makeContext(params: Record<string, string>, user: { id: string }): ExecutionContext {
  const request = { params, user };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

describe('RolesGuard caching (Challenge X3)', () => {
  let guard: RolesGuard;
  let membershipCache: MembershipCacheService;
  let findOneMock: jest.Mock;

  beforeEach(async () => {
    findOneMock = jest.fn().mockResolvedValue({
      userId: '11111111-1111-4111-8111-111111111111',
      projectId: '33333333-3333-4333-8333-333333333333',
      role: ProjectRole.MEMBER,
    });

    const fakeReflector = {
      getAllAndOverride: jest.fn((key: string) => {
        if (key === ROLES_KEY) return [ProjectRole.OWNER, ProjectRole.ADMIN, ProjectRole.MEMBER];
        if (key === RESOURCE_KEY) return { type: 'project', param: 'id' };
        return undefined;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RolesGuard,
        MembershipCacheService,
        { provide: Reflector, useValue: fakeReflector },
        {
          provide: getDataSourceToken(),
          useValue: {
            getRepository: jest.fn(() => ({ findOne: findOneMock })),
          },
        },
      ],
    }).compile();

    guard = module.get(RolesGuard);
    membershipCache = module.get(MembershipCacheService);
  });

  it('queries the database on the first call for a (user, project) pair', async () => {
    const context = makeContext({ id: '33333333-3333-4333-8333-333333333333' }, { id: '11111111-1111-4111-8111-111111111111' });
    await guard.canActivate(context);
    expect(findOneMock).toHaveBeenCalledTimes(1);
  });

  it('does not query the database again on a repeated request - the whole point of X3', async () => {
    const context = makeContext({ id: '33333333-3333-4333-8333-333333333333' }, { id: '11111111-1111-4111-8111-111111111111' });

    await guard.canActivate(context);
    await guard.canActivate(context);
    await guard.canActivate(context);

    expect(findOneMock).toHaveBeenCalledTimes(1);
  });

  it('queries the database again for a different user or project (no false cache hit)', async () => {
    await guard.canActivate(makeContext({ id: '33333333-3333-4333-8333-333333333333' }, { id: '11111111-1111-4111-8111-111111111111' }));
    await guard.canActivate(makeContext({ id: '33333333-3333-4333-8333-333333333333' }, { id: '22222222-2222-4222-8222-222222222222' }));
    await guard.canActivate(makeContext({ id: '44444444-4444-4444-8444-444444444444' }, { id: '11111111-1111-4111-8111-111111111111' }));

    expect(findOneMock).toHaveBeenCalledTimes(3);
  });

  it('invalidate() makes the very next request hit the database again - no waiting for TTL', async () => {
    const context = makeContext({ id: '33333333-3333-4333-8333-333333333333' }, { id: '11111111-1111-4111-8111-111111111111' });

    await guard.canActivate(context);
    expect(findOneMock).toHaveBeenCalledTimes(1);

    membershipCache.invalidate('11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333');
    await guard.canActivate(context);

    expect(findOneMock).toHaveBeenCalledTimes(2);
  });

  it('a revoked membership takes effect on the very next request after invalidate()', async () => {
    const context = makeContext({ id: '33333333-3333-4333-8333-333333333333' }, { id: '11111111-1111-4111-8111-111111111111' });

    // First call: user is a member, request succeeds.
    await expect(guard.canActivate(context)).resolves.toBe(true);

    // Membership revoked in the database, and the cache is told about it -
    // exactly what ProjectsService.remove()/future membership endpoints do.
    findOneMock.mockResolvedValue(null);
    membershipCache.invalidate('11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333');

    // No stale cache hit - the very next call sees the revocation.
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('(Problem C3) rejects a malformed id with 400 before ever touching the database', async () => {
    const context = makeContext({ id: 'not-a-uuid' }, { id: '11111111-1111-4111-8111-111111111111' });

    await expect(guard.canActivate(context)).rejects.toThrow('Invalid project id');
    expect(findOneMock).not.toHaveBeenCalled();
  });
});
