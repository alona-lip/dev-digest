import { describe, it, expect } from 'vitest';
import { assemblePrompt } from '../src/prompt.js';

// Regression guard (AC-47): with no specs, the assembled prompt must stay
// byte-identical to what it was before the project-context slot changed.
describe('assemblePrompt without specs (snapshot)', () => {
  it('minimal fixture', () => {
    const { messages, assembly } = assemblePrompt({
      system: 'You are a reviewer.',
      diff: '@@ -1 +1 @@\n+x',
    });
    expect({ messages, assembly }).toMatchSnapshot();
  });

  it('full fixture without specs', () => {
    const { messages, assembly } = assemblePrompt({
      system: 'You are a reviewer.',
      skills: [{ name: 'secret-gate', body: 'Detect sk_live' }],
      memory: ['Do not flag try/catch around JSON.parse'],
      repoMap: 'src/a.ts: function a()',
      callers: 'b.ts calls a()',
      intent: 'Add rate limiting',
      prDescription: 'Adds a rate limiter.',
      diff: '@@ -1 +1 @@\n+ stripeKey',
      task: "Review PR #482 'rate limit'",
    });
    expect({ messages, assembly }).toMatchSnapshot();
  });
});
