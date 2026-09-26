import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './configure-app';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  configureApp(app);

  app.useGlobalInterceptors(new LoggingInterceptor());
  app.enableShutdownHooks();

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
}
bootstrap();