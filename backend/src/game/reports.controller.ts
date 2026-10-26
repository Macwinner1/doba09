import { Controller, Get, NotFoundException, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../common/current-user.decorator';
import { GameResultsService } from './game-results.service';

@Controller('reports')
@UseGuards(JwtAuthGuard)
export class ReportsController {
  constructor(private readonly results: GameResultsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.results.listSessionsForHost(user.id);
  }

  @Get(':sessionId')
  async findOne(@Param('sessionId') sessionId: string, @CurrentUser() user: AuthUser) {
    const report = await this.results.getSessionReport(sessionId, user.id);
    if (!report) throw new NotFoundException('Report not found');
    return report;
  }
}
