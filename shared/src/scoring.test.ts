import { describe, expect, it } from 'vitest';
import { calculateScore, compensateForLatency, rankPlayers } from './scoring.js';

describe('calculateScore', () => {
  const base = { isCorrect: true, timeLimitSeconds: 20, pointsPossible: 1000 };

  it('gives nothing for a wrong answer, however fast', () => {
    expect(calculateScore({ ...base, isCorrect: false, responseMs: 10 })).toBe(0);
  });

  it('gives full points inside the grace window', () => {
    expect(calculateScore({ ...base, responseMs: 0 })).toBe(1000);
    expect(calculateScore({ ...base, responseMs: 500 })).toBe(1000);
  });

  it('decays linearly to half value across the timer', () => {
    // Halfway through a 20s timer -> 1 - (0.5 / 2) = 0.75
    expect(calculateScore({ ...base, responseMs: 10_000 })).toBe(750);
    // Quarter of the way -> 1 - (0.25 / 2) = 0.875
    expect(calculateScore({ ...base, responseMs: 5_000 })).toBe(875);
  });

  it('never drops below half value, even at the buzzer', () => {
    expect(calculateScore({ ...base, responseMs: 20_000 })).toBe(500);
    expect(calculateScore({ ...base, responseMs: 999_999 })).toBe(500);
  });

  it('scales with the question face value', () => {
    expect(calculateScore({ ...base, pointsPossible: 2000, responseMs: 10_000 })).toBe(1500);
    expect(calculateScore({ ...base, pointsPossible: 0, responseMs: 10 })).toBe(0);
  });
});

describe('compensateForLatency', () => {
  it('credits back half the round trip', () => {
    expect(compensateForLatency(3_000, 400)).toBe(2_800);
  });

  it('caps the credit so a faked RTT cannot buy time', () => {
    expect(compensateForLatency(5_000, 60_000)).toBe(4_500);
  });

  it('never returns a negative time', () => {
    expect(compensateForLatency(50, 900)).toBe(0);
  });
});

describe('rankPlayers', () => {
  it('ranks by score descending', () => {
    const ranked = rankPlayers([
      { nickname: 'ada', score: 400 },
      { nickname: 'bem', score: 900 },
      { nickname: 'chi', score: 650 },
    ]);
    expect(ranked.map((p) => p.nickname)).toEqual(['bem', 'chi', 'ada']);
    expect(ranked.map((p) => p.rank)).toEqual([1, 2, 3]);
  });

  it('gives tied players the same rank and skips the next', () => {
    const ranked = rankPlayers([
      { nickname: 'ada', score: 900 },
      { nickname: 'bem', score: 900 },
      { nickname: 'chi', score: 100 },
    ]);
    expect(ranked.map((p) => p.rank)).toEqual([1, 1, 3]);
  });
});
