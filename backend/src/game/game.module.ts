import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { QuizzesModule } from '../quizzes/quizzes.module';
import { GameBroadcaster } from './game.broadcaster';
import { GameEngineService } from './game-engine.service';
import { GameGateway } from './game.gateway';
import { GameResultsService } from './game-results.service';
import { GameStateRepository } from './game-state.repository';
import { PinService } from './pin.service';
import { ReportsController } from './reports.controller';

@Module({
  // AuthModule for redeeming host socket tickets.
  imports: [QuizzesModule, AuthModule],
  controllers: [ReportsController],
  providers: [
    GameGateway,
    GameEngineService,
    GameStateRepository,
    GameResultsService,
    GameBroadcaster,
    PinService,
  ],
})
export class GameModule {}
