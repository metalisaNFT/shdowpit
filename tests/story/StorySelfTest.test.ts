import { describe, expect, it } from 'vitest';
import { runStorySelfTest } from '../../src/story/StorySelfTest';

describe('StorySelfTest', () => {
  it('passes all deterministic story assertions', () => {
    const result = runStorySelfTest();
    const failures = result.results.filter((r) => !r.ok);
    if (failures.length > 0) {
      console.error(failures.map((f) => `${f.name}: ${f.detail}`).join('\n'));
    }
    expect(result.failed).toBe(0);
    expect(result.passed).toBeGreaterThan(10);
  });
});
