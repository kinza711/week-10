import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ThrottlerModule } from "@nestjs/throttler";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard } from "@nestjs/throttler";
import { AuthModule } from "./auth/auth.module";
import { UsersModule } from "./users/users.module";
import { ProjectsModule } from "./projects/projects.module";
import { TasksModule } from "./tasks/tasks.module";
import { CommentsModule } from "./comments/comments.module";
import { AuthorizationModule } from "./authorization/authorization.module";
import { envValidationSchema } from "./config/env.validation";
import { HealthModule } from "./health/health.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: process.env.NODE_ENV === "test" ? ".env.test" : ".env",
      validationSchema: envValidationSchema,
      validationOptions: { abortEarly: false },
    }),
    // Problem W1. A generous app-wide default; individual auth routes
    // tighten this further with their own @Throttle() (see
    // auth.controller.ts) since login is the one route an attacker can
    // call forever with a password list.
    ThrottlerModule.forRoot([{ name: "default", ttl: 60_000, limit: 100 }]),
    TypeOrmModule.forRoot({
      type: "postgres",
      host: process.env.DB_HOST ?? "localhost",
      port: Number(process.env.DB_PORT ?? 5432),
      username: process.env.DB_USERNAME ?? "postgres",
      password: process.env.DB_PASSWORD ?? "postgres",
      database: process.env.DB_NAME ?? "week9_auth",
      autoLoadEntities: true,
      // Schema changes go through committed migrations only - see
      // src/database/migrations. Never true, in any environment.
      synchronize: false,
    }),
    UsersModule,
    AuthModule,
    AuthorizationModule,
    ProjectsModule,
    TasksModule,
    CommentsModule,
    HealthModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
