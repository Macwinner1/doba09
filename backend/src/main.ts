import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const config = app.get(ConfigService);

  app.setGlobalPrefix('api', { exclude: ['health'] });
  app.use(cookieParser());
  app.use(
    helmet({
      // The API serves JSON and websockets only; CSP here would only ever
      // affect Nest's own error pages.
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  app.enableCors({
    origin: config.getOrThrow<string[]>('corsOrigins'),
    credentials: true,
  });

  // No global ValidationPipe: every endpoint validates with the shared Zod
  // schemas via ZodValidationPipe, so class-validator would be a second,
  // redundant validation stack.
  app.enableShutdownHooks();

  const port = config.getOrThrow<number>('PORT');
  await app.listen(port, '0.0.0.0');

  new Logger('Bootstrap').log(`Feyi API listening on http://localhost:${port}`);
}

void bootstrap();
