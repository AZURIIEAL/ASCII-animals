import { afterEach, describe, expect, it } from 'vitest';
import { installFakeDom, type FakeEnv } from './helpers/dom';
import { createAsciiField } from '../src/index';
import { STYLE_ID } from '../src/ui/styles';

let env: FakeEnv | null = null;

afterEach(() => {
  env?.restore();
  env = null;
});

describe('createAsciiField lifecycle', () => {
  it('mounts a canvas and schedules frames', () => {
    env = installFakeDom();
    const field = createAsciiField({ host: env.host as never, seed: 7, persist: false });
    expect(env.host.afNodes().map((n) => n.className)).toContain('af-canvas');
    expect(env.counters.rafScheduled).toBeGreaterThan(0);
    env.tick();
    expect(env.pendingFrames()).toBe(1);
    field.destroy();
  });

  it('destroy() leaves no af-* nodes, listeners or scheduled frames', () => {
    env = installFakeDom();
    const before = env.counters.listeners;
    const field = createAsciiField({ host: env.host as never, seed: 7, persist: false });
    expect(env.counters.listeners).toBeGreaterThan(before);
    env.tick();

    field.destroy();

    expect(env.host.afNodes()).toHaveLength(0);
    expect(env.counters.listeners).toBe(before);
    expect(env.counters.disconnected).toBe(env.counters.observers);
    env.tick();
    expect(env.pendingFrames()).toBe(0);
    expect((globalThis as { document: { getElementById(id: string): unknown } }).document
      .getElementById(STYLE_ID)).toBeNull();
  });

  it('survives 20 mount/destroy cycles with nothing left behind (stress)', () => {
    env = installFakeDom();
    const before = env.counters.listeners;
    for (let i = 0; i < 20; i++) {
      const field = createAsciiField({ host: env.host as never, seed: i, persist: false });
      env.tick();
      field.destroy();
    }
    expect(env.host.afNodes()).toHaveLength(0);
    expect(env.counters.listeners).toBe(before);
    env.tick();
    expect(env.pendingFrames()).toBe(0);
  });

  it('pause() stops scheduling and resume() starts again', () => {
    env = installFakeDom();
    const field = createAsciiField({ host: env.host as never, seed: 3, persist: false });
    env.tick();
    field.pause();
    env.tick();
    expect(env.pendingFrames()).toBe(0);
    field.resume();
    expect(env.pendingFrames()).toBe(1);
    field.destroy();
  });
});
