import { describe, expect, it } from 'vitest';
import { compactAgent } from '../src/format.js';
import { agent } from './fixtures.js';

describe('compactAgent', () => {
  it('keeps the description the model picks a reviewer by, drops the prompt and config', () => {
    const a = { ...agent('a-sec', 'Security Reviewer'), description: 'Finds injection and auth bugs' };
    expect(compactAgent(a)).toEqual({
      id: 'a-sec',
      name: 'Security Reviewer',
      description: 'Finds injection and auth bugs',
      enabled: true,
      model: 'gpt-4o-mini',
    });
  });
});
