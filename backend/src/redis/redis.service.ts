import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

/**
 * Owns the Redis connections.
 *
 * Three separate clients, deliberately: a connection in subscriber mode cannot
 * issue normal commands, so the Socket.IO adapter's pub and sub clients must be
 * distinct from the one the game engine uses for reads and writes.
 */
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);

  readonly client: Redis;
  readonly pubClient: Redis;
  readonly subClient: Redis;

  constructor(config: ConfigService) {
    const url = config.getOrThrow<string>('REDIS_URL');

    const options = {
      maxRetriesPerRequest: null,
      // A game in progress must survive a brief Redis blip rather than
      // dropping every player, so we retry with a bounded backoff.
      retryStrategy: (times: number) => Math.min(times * 200, 3_000),
    };

    this.client = new Redis(url, options);
    this.pubClient = new Redis(url, options);
    this.subClient = this.pubClient.duplicate();

    this.client.on('error', (err) =>
      this.logger.error(`Redis error: ${err.message}`),
    );
  }

  async onModuleInit(): Promise<void> {
    await this.client.ping();
    this.logger.log('Connected to Redis');
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.allSettled([
      this.client.quit(),
      this.pubClient.quit(),
      this.subClient.quit(),
    ]);
  }
}
