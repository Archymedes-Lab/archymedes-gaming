import { describe, expect, it } from 'vitest';
import { InMemoryStorage, decodeSnapshot, encodeSnapshot, SNAPSHOT_VERSION } from '../../src/core/persistence';
import { GameWorld } from '../../src/core/world';

describe('persistence', () => {
  it('reports fresh when nothing is saved', () => {
    expect(decodeSnapshot(null).status).toBe('fresh');
  });

  it('round-trips a snapshot', () => {
    const snap = { version: SNAPSHOT_VERSION, world: new GameWorld().toJSON(), agents: {} };
    const r = decodeSnapshot(encodeSnapshot(snap));
    expect(r.status).toBe('restored');
    if (r.status === 'restored') expect(r.snapshot).toEqual(snap);
  });

  it('reports corrupt data instead of throwing', () => {
    expect(decodeSnapshot('{not json').status).toBe('corrupt');
    expect(decodeSnapshot(JSON.stringify({ version: 0 })).status).toBe('corrupt');
  });

  it('InMemoryStorage behaves like Web Storage', () => {
    const s = new InMemoryStorage();
    expect(s.getItem('k')).toBeNull();
    s.setItem('k', 'v');
    expect(s.getItem('k')).toBe('v');
    s.removeItem('k');
    expect(s.getItem('k')).toBeNull();
  });
});
