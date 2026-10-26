import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { PrismaService } from './prisma/prisma.service';
import { RedisService } from './redis/redis.service';

@Controller('health')
@SkipThrottle()
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Get()
  async check() {
    // Both dependencies are checked, because a backend that can serve HTTP but
    // cannot reach Redis cannot run a game — it should fail its health check.
    const [postgres, redis] = await Promise.all([
      this.prisma.$queryRaw`SELECT 1`.then(() => 'up').catch(() => 'down'),
      this.redis.client.ping().then(() => 'up').catch(() => 'down'),
    ]);

    return {
      status: postgres === 'up' && redis === 'up' ? 'ok' : 'degraded',
      postgres,
      redis,
      uptime: Math.round(process.uptime()),
    };
  }
}
