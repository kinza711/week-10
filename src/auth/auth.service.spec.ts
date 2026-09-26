import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { RefreshToken } from './entities/refresh-token.entity';
import { User } from '../users/user.entity';

describe('AuthService', () => {
  let service: AuthService;
  let usersService: jest.Mocked<UsersService>;
  let refreshTokensRepo: {
    create: jest.Mock;
    save: jest.Mock;
    findOne: jest.Mock;
    createQueryBuilder: jest.Mock;
  };

  const makeUser = (overrides: Partial<User> = {}): User =>
    ({
      id: 'user-1',
      email: 'kinza@example.com',
      passwordHash: '',
      createdAt: new Date(),
      refreshTokens: [],
      ...overrides,
    } as User);

  beforeEach(async () => {
    const queryBuilderMock: any = {
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ affected: 2 }),
    };

    refreshTokensRepo = {
      create: jest.fn((data) => data),
      save: jest.fn(async (row) => row),
      findOne: jest.fn(),
      createQueryBuilder: jest.fn(() => queryBuilderMock),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: getRepositoryToken(RefreshToken),
          useValue: refreshTokensRepo,
        },
        {
          provide: UsersService,
          useValue: {
            findByEmail: jest.fn(),
            findById: jest.fn(),
            create: jest.fn(),
          },
        },
        {
          provide: JwtService,
          useValue: { sign: jest.fn(() => 'signed.jwt.token') },
        },
        {
          provide: ConfigService,
          useValue: { get: jest.fn((_key: string, fallback?: string) => fallback) },
        },
      ],
    }).compile();

    service = module.get(AuthService);
    usersService = module.get(UsersService);
  });

  describe('validateCredentials (Problem C1)', () => {
    it('accepts the right password', async () => {
      const passwordHash = await argon2.hash('correct-horse-battery-staple');
      usersService.findByEmail.mockResolvedValue(makeUser({ passwordHash }));

      const result = await service.validateCredentials(
        'kinza@example.com',
        'correct-horse-battery-staple',
      );

      expect(result.email).toBe('kinza@example.com');
    });

    it('rejects a wrong password with 401', async () => {
      const passwordHash = await argon2.hash('the-real-password');
      usersService.findByEmail.mockResolvedValue(makeUser({ passwordHash }));

      await expect(
        service.validateCredentials('kinza@example.com', 'wrong-password'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects an unknown email with the exact same 401', async () => {
      usersService.findByEmail.mockResolvedValue(null);

      await expect(
        service.validateCredentials('nobody@example.com', 'whatever'),
      ).rejects.toThrow('Invalid email or password');
    });
  });

  describe('refresh rotation (Problem C3)', () => {
    it('revokes the old token and issues a new pair', async () => {
      const oldRow = {
        id: 'rt-1',
        userId: 'user-1',
        tokenHash: 'hash-of-raw-token',
        familyId: 'family-1',
        expiresAt: new Date(Date.now() + 60_000),
        revokedAt: null,
      };
      refreshTokensRepo.findOne.mockResolvedValue(oldRow);
      usersService.findById.mockResolvedValue(makeUser());

      const result = await service.refresh('raw-token-value');

      expect(oldRow.revokedAt).not.toBeNull();
      expect(refreshTokensRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ revokedAt: expect.any(Date) }),
      );
      expect(result.accessToken).toBe('signed.jwt.token');
      expect(result.refreshToken).toBeDefined();
    });

    it('rejects a refresh token that was already revoked', async () => {
      refreshTokensRepo.findOne.mockResolvedValue({
        id: 'rt-1',
        userId: 'user-1',
        tokenHash: 'hash-of-raw-token',
        familyId: 'family-1',
        expiresAt: new Date(Date.now() + 60_000),
        revokedAt: new Date(),
      });

      await expect(service.refresh('raw-token-value')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('(Challenge X1) revokes the whole token family on reuse of a revoked token', async () => {
      refreshTokensRepo.findOne.mockResolvedValue({
        id: 'rt-1',
        userId: 'user-1',
        tokenHash: 'hash-of-raw-token',
        familyId: 'family-1',
        expiresAt: new Date(Date.now() + 60_000),
        revokedAt: new Date(),
      });

      await expect(service.refresh('raw-token-value')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );

      const queryBuilder = refreshTokensRepo.createQueryBuilder.mock.results[0].value;
      expect(refreshTokensRepo.createQueryBuilder).toHaveBeenCalled();
      expect(queryBuilder.update).toHaveBeenCalled();
      expect(queryBuilder.where).toHaveBeenCalledWith(
        'familyId = :familyId',
        { familyId: 'family-1' },
      );
      expect(queryBuilder.execute).toHaveBeenCalled();
    });

    it('(Challenge X2) rejects an expired refresh token even though it was never revoked', async () => {
      refreshTokensRepo.findOne.mockResolvedValue({
        id: 'rt-1',
        userId: 'user-1',
        tokenHash: 'hash-of-raw-token',
        familyId: 'family-1',
        expiresAt: new Date(Date.now() - 1000), // expired one second ago
        revokedAt: null, // deliberately not revoked - expiry alone must stop it
      });

      await expect(service.refresh('raw-token-value')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      // An expired token must not be silently rotated - no new row saved.
      expect(refreshTokensRepo.save).not.toHaveBeenCalled();
    });
  });
});
