import { Injectable } from '@nestjs/common';
import type { ServerToClientEvents } from '@feyi/shared';
import type { Namespace } from 'socket.io';

/**
 * Thin wrapper over the Socket.IO server.
 *
 * It exists so the engine can broadcast without importing the gateway — the
 * gateway registers its server here at boot, and the dependency only ever
 * points one way (gateway -> engine -> broadcaster).
 */
@Injectable()
export class GameBroadcaster {
  private server: Namespace | null = null;

  register(namespace: Namespace): void {
    this.server = namespace;
  }

  /**
   * Room layout. Separating host from players is a correctness requirement,
   * not a convenience: the correct-answer index is broadcast to the host room
   * while a question is live, and must never reach a player socket.
   */
  static roomAll(pin: string) { return `game:${pin}`; }
  static roomHost(pin: string) { return `game:${pin}:host`; }
  static roomPlayers(pin: string) { return `game:${pin}:players`; }
  static roomPlayer(pin: string, playerId: string) { return `game:${pin}:p:${playerId}`; }

  toAll<E extends keyof ServerToClientEvents>(
    pin: string,
    event: E,
    ...args: Parameters<ServerToClientEvents[E]>
  ): void {
    this.server?.to(GameBroadcaster.roomAll(pin)).emit(event, ...args);
  }

  toHost<E extends keyof ServerToClientEvents>(
    pin: string,
    event: E,
    ...args: Parameters<ServerToClientEvents[E]>
  ): void {
    this.server?.to(GameBroadcaster.roomHost(pin)).emit(event, ...args);
  }

  toPlayers<E extends keyof ServerToClientEvents>(
    pin: string,
    event: E,
    ...args: Parameters<ServerToClientEvents[E]>
  ): void {
    this.server?.to(GameBroadcaster.roomPlayers(pin)).emit(event, ...args);
  }

  toPlayer<E extends keyof ServerToClientEvents>(
    pin: string,
    playerId: string,
    event: E,
    ...args: Parameters<ServerToClientEvents[E]>
  ): void {
    this.server?.to(GameBroadcaster.roomPlayer(pin, playerId)).emit(event, ...args);
  }

  /** Force every socket in a game to drop, used when the host ends it. */
  async disconnectAll(pin: string): Promise<void> {
    const sockets = await this.server?.in(GameBroadcaster.roomAll(pin)).fetchSockets();
    sockets?.forEach((socket) => socket.disconnect(true));
  }
}
