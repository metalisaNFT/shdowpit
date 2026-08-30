import { describe, expect, it } from 'vitest';
import { CYCLE_BEAT_RATIO } from '../../src/sim/TimeModel';

describe('TimeModel', () => {
  it('unifies god cycle and world beat at ratio 1', () => {
    expect(CYCLE_BEAT_RATIO).toBe(1);
  });
});
