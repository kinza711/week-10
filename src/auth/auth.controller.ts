import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { Public } from '../common/decorators/public.decorator';

// Problem W1: register, login, and refresh get a much tighter limit than
// the app-wide default (ThrottlerModule.forRoot in app.module.ts) -
// login is the one route an attacker can call forever with a password
// list, and refresh/register are the same shape of risk.
//
// Tracked per IP address (Throttler's default), not per account: a
// per-account limit can't apply to a wrong-password attempt against an
// account that doesn't exist, and would need the login attempt to
// partially succeed before it could even identify which account to
// throttle. The trade-off: this would throttle every user behind the
// same IP together - most visibly, a shared office or campus NAT, where
// one person's failed attempts could lock out their coworkers on the
// same connection for the rest of the window.
//
// Raised under NODE_ENV=test (same pattern as argon2.config.ts in
// Assignment 1's Challenge X3) - the functional e2e suites make well
// over 5 auth calls each in a single run, and a production-strength
// limit would trip on ordinary test traffic, not just abuse. The
// dedicated throttle test (test/throttle.e2e-spec.ts) fires enough
// requests to exceed even this raised limit, so the mechanism is still
// proven end to end, just against a bigger number.
const AUTH_THROTTLE_LIMIT =
  process.env.NODE_ENV === 'test' ? 20 : Number(process.env.AUTH_THROTTLE_LIMIT ?? 5);
const AUTH_THROTTLE = { default: { limit: AUTH_THROTTLE_LIMIT, ttl: 60_000 } };

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto.email, dto.password);
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto.email, dto.password);
  }

  // Authenticated by possession of a valid refresh token in the body,
  // not by an access token - also exempt from the global JwtAuthGuard.
  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refresh(dto.refreshToken);
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Body() dto: RefreshTokenDto): Promise<void> {
    await this.authService.logout(dto.refreshToken);
  }
}
