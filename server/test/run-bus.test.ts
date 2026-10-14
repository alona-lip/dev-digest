import { describe, it, expect, vi, afterEach } from 'vitest';
import type { RunEvent } from '@devdigest/shared';
import { RunBus, COMPLETED_BUFFER_RETENTION_MS } from '../src/platform/sse.js';

/**
 * RunBus — the in-memory live log behind `/runs/:id/events`. Pins replay for
 * late subscribers, that a finished run's stream ends instead of hanging, and
 * that finished buffers are released (they used to live for the whole process).
 */
describe('RunBus', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('replays the buffer to a subscriber that joins mid-run, then streams live', () => {
    const bus = new RunBus();
    bus.publish('r1', 'info', 'first');
    const seen: RunEvent[] = [];
    bus.subscribe('r1', (e) => seen.push(e));
    bus.publish('r1', 'info', 'second');
    expect(seen.map((e) => [e.seq, e.msg])).toEqual([
      [1, 'first'],
      [2, 'second'],
    ]);
  });

  it('a late subscriber to a finished run gets the replay and an immediate done', async () => {
    const bus = new RunBus();
    bus.publish('r2', 'info', 'only');
    bus.complete('r2');

    const seen: string[] = [];
    bus.subscribe('r2', (e) => seen.push(e.msg));
    const done = new Promise<void>((resolve) => bus.onDone('r2', resolve));
    await done;
    expect(seen).toEqual(['only']);
  });

  it('releases a finished run’s buffer after the retention window', () => {
    vi.useFakeTimers();
    const bus = new RunBus();
    bus.publish('r3', 'info', 'x');
    bus.complete('r3');
    expect(bus.buffer('r3')).toHaveLength(1);

    vi.advanceTimersByTime(COMPLETED_BUFFER_RETENTION_MS + 1);
    expect(bus.buffer('r3')).toEqual([]);
    // Still known as finished, so a late SSE stream ends rather than hangs.
    expect(bus.isComplete('r3')).toBe(true);
  });
});
