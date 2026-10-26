import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { PIN_MAX, PIN_MIN } from '@feyi/shared';
import { randomInt } from 'node:crypto';
import { GameStateRepository } from './game-state.repository';

@Injectable()
export class PinService {
  private static readonly MAX_ATTEMPTS = 12;

  constructor(private readonly state: GameStateRepository) {}

  /**
   * Allocate an unused game PIN.
   *
   * `randomInt` rather than `Math.random` so PINs aren't predictable — guessing
   * a live PIN is how a stranger crashes someone's classroom game. The retry
   * loop handles collisions; with 900k PINs and a realistic number of concurrent
   * games, a second attempt is already rare.
   */
  async allocate(): Promise<string> {
    for (let attempt = 0; attempt < PinService.MAX_ATTEMPTS; attempt++) {
      const pin = String(randomInt(PIN_MIN, PIN_MAX + 1));
      if (await this.state.claimPin(pin)) return pin;
    }

    throw new InternalServerErrorException(
      'Could not allocate a game PIN, please try again',
    );
  }
}
