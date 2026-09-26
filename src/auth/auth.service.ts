import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Repository } from 'typeorm';
import * as argon2 from 'argon2';
import { randomBytes, randomUUID, createHash } from 'crypto';
import { getArgon2Options } from '../config/argon2.config';
import { RefreshToken } from './entities/refresh-token.entity';
import { UsersService } from '../users/users.service';
import { User } from '../users/user.entity';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

// ms helpers for turning "7d" / "15m" style durations into a Date.
// Kept tiny and dependency-free rather than pulling in a whole ms package.
const DURATION_UNITS: Record<string, number> = {
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
};

function parseDurationMs(duration: string): number {
  const match = /^(\d+)([smhd])$/.exec(duration.trim());
  if (!match) {
    throw new Error(`Invalid duration format: "${duration}"`);
  }
  const [, amount, unit] = match;
  return Number(amount) * DURATION_UNITS[unit];
}

function hashToken(rawToken: string): string {
  // The raw refresh token is only ever held by the client. The database
  // stores this hash, same principle as the password.
  return createHash('sha256').update(rawToken).digest('hex');
}

export interface SafeUser {
  id: string;
  email: string;
  createdAt: Date;
}

function toSafeUser(user: User): SafeUser {
  // Built from an explicit field list - never spread the entity - so
  // passwordHash can never leak into a response body, here or anywhere
  // else this helper is reused.
  return { id: user.id, email: user.email, createdAt: user.createdAt };
}

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(RefreshToken)
    private readonly refreshTokensRepository: Repository<RefreshToken>,
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async register(email: string, password: string): Promise<SafeUser> {
    const existing = await this.usersService.findByEmail(email);
    if (existing) {
      // Registration is allowed to reveal that the email is taken - this
      // is a different trust boundary from login, which must not (see
      // login()'s identical-401 handling in Problem C1).
      throw new ConflictException('Email is already registered');
    }

    // argon2id is deliberately slow and salted, unlike a fast hash such as
    // SHA-256 which is cheap to guess in bulk. Cost comes from config
    // (Challenge X3) so the suite doesn't pay production-strength cost on
    // every test run.
    const passwordHash = await argon2.hash(password, getArgon2Options());

    const user = await this.usersService.create(email, passwordHash);
    return toSafeUser(user);
  }

  /**
   * Verifies credentials for Problem C1. Returns the matching user on
   * success. On failure it throws the exact same 401 for a wrong password
   * and for an email that does not exist at all - two different responses
   * would tell an attacker which emails are registered.
   */
  async validateCredentials(email: string, password: string): Promise<SafeUser> {
    const user = await this.usersService.findByEmail(email);

    if (!user) {
      // Still run a hash comparison so a nonexistent email doesn't return
      // measurably faster than a wrong password would - both paths do the
      // same amount of work before failing.
      await argon2.hash(password, getArgon2Options()).catch(() => undefined);
      throw new UnauthorizedException('Invalid email or password');
    }

    const passwordMatches = await argon2.verify(user.passwordHash, password);
    if (!passwordMatches) {
      throw new UnauthorizedException('Invalid email or password');
    }

    return toSafeUser(user);
  }

  /**
   * Problem C2. Issues a fresh access/refresh pair for a user, starting a
   * brand new token family. Every rotation of this pair (Problem C3,
   * refresh()) reuses the same family id so reuse detection (Challenge X1)
   * can revoke the whole family at once if a revoked token comes back.
   */
  private async issueTokenPair(
    userId: string,
    email: string,
    familyId: string,
  ): Promise<TokenPair> {
    // Payload is deliberately minimal: sub and email only. Anyone holding
    // this JWT can read its payload (it is signed, not encrypted), so no
    // role, no secret, no claim beyond what identifying the caller needs.
    const accessToken = this.jwtService.sign({ sub: userId, email });

    const rawRefreshToken = randomBytes(64).toString('hex');
    const refreshExpiresIn = this.configService.get<string>(
      'JWT_REFRESH_EXPIRES_IN',
      '7d',
    );
    const expiresAt = new Date(Date.now() + parseDurationMs(refreshExpiresIn));

    const refreshTokenRow = this.refreshTokensRepository.create({
      userId,
      tokenHash: hashToken(rawRefreshToken),
      familyId,
      expiresAt,
      revokedAt: null,
    });
    await this.refreshTokensRepository.save(refreshTokenRow);

    return { accessToken, refreshToken: rawRefreshToken };
  }

  /**
   * Full login flow: verify credentials (C1), then issue a token pair
   * that starts a new family (C2).
   */
  async login(email: string, password: string): Promise<TokenPair> {
    const user = await this.validateCredentials(email, password);
    return this.issueTokenPair(user.id, user.email, randomUUID());
  }

  /**
   * Problem C3, extended by Challenge X1. Validates the refresh token,
   * revokes it, and issues a new pair in the same family. If a token that
   * was already revoked is presented again, every token in its family is
   * revoked too (see the reuse-detection branch below) - that's the sign
   * a stolen token is being used alongside the real one.
   */
  async refresh(rawRefreshToken: string): Promise<TokenPair> {
    const tokenHash = hashToken(rawRefreshToken);
    const existing = await this.refreshTokensRepository.findOne({
      where: { tokenHash },
    });

    if (!existing) {
      throw new UnauthorizedException('Invalid refresh token');
    }
    if (existing.revokedAt) {
      // Reuse detected: a token that was already revoked has come back.
      // That only happens if two parties are holding descendants of the
      // same family - the legitimate client and, most likely, a thief who
      // stole an earlier refresh token in the chain. We can't tell which
      // caller is which, so the safe move is to end every session in the
      // family: revoke every token that shares this family_id.
      await this.refreshTokensRepository
        .createQueryBuilder()
        .update(RefreshToken)
        .set({ revokedAt: new Date() })
        .where('familyId = :familyId', { familyId: existing.familyId })
        .andWhere('revokedAt IS NULL')
        .execute();

      throw new UnauthorizedException('Invalid refresh token');
    }
    if (existing.expiresAt.getTime() < Date.now()) {
      // Expiry and revocation are separate defences - a token nobody
      // explicitly revoked still has to die on its own.
      throw new UnauthorizedException('Invalid refresh token');
    }

    existing.revokedAt = new Date();
    await this.refreshTokensRepository.save(existing);

    const user = await this.usersService.findById(existing.userId);
    if (!user) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    return this.issueTokenPair(user.id, user.email, existing.familyId);
  }

  /**
   * Problem C4. Revokes exactly the refresh token that was presented, not
   * every token the user holds - logging out on one device shouldn't sign
   * the user out everywhere unless that was explicitly decided elsewhere.
   * Idempotent and silent on an unknown/already-revoked token so logout
   * never becomes an oracle for guessing valid tokens.
   */
  async logout(rawRefreshToken: string): Promise<void> {
    const tokenHash = hashToken(rawRefreshToken);
    const existing = await this.refreshTokensRepository.findOne({
      where: { tokenHash },
    });

    if (!existing || existing.revokedAt) {
      return;
    }

    existing.revokedAt = new Date();
    await this.refreshTokensRepository.save(existing);
  }
}
