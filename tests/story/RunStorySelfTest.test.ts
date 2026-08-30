import { describe, expect, it } from 'vitest';
import { runRunStorySelfTest } from '../../src/story/RunStory/RunStorySelfTest';

describe('RunStorySelfTest', () => {
  it('passes all deterministic RunStory assertions', () => {
    const result = runRunStorySelfTest();
    const failures = result.results.filter((r) => !r.ok);
    if (failures.length > 0) {
      console.error(failures.map((f) => `${f.name}: ${f.detail}`).join('\n'));
    }
    expect(result.failed).toBe(0);
    expect(result.passed).toBeGreaterThan(10);
  });
});
