import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { quizInputSchema, type QuizInput } from '@feyi/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../common/current-user.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { QuizzesService } from './quizzes.service';

@Controller('quizzes')
@UseGuards(JwtAuthGuard)
export class QuizzesController {
  constructor(private readonly quizzes: QuizzesService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.quizzes.listForOwner(user.id);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.quizzes.findOneForOwner(id, user.id);
  }

  @Post()
  create(
    @Body(new ZodValidationPipe(quizInputSchema)) body: QuizInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.quizzes.create(user.id, body);
  }

  @Put(':id')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(quizInputSchema)) body: QuizInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.quizzes.update(id, user.id, body);
  }

  @Post(':id/duplicate')
  duplicate(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.quizzes.duplicate(id, user.id);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    await this.quizzes.remove(id, user.id);
  }
}
