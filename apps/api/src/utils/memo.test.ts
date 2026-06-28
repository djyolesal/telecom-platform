import { memo, clearMemo } from './memo';

describe('memo (cache TTL court)', () => {
  beforeEach(() => clearMemo());

  it('ne calcule qu’une fois dans la fenêtre TTL', async () => {
    let n = 0;
    const fn = () => Promise.resolve(++n);
    expect(await memo('k', 1000, fn)).toBe(1);
    expect(await memo('k', 1000, fn)).toBe(1); // servi du cache
    expect(n).toBe(1);
  });

  it('déduplique les appels concurrents', async () => {
    let calls = 0;
    const fn = () => { calls++; return new Promise<number>((r) => setTimeout(() => r(42), 10)); };
    const [a, b] = await Promise.all([memo('c', 1000, fn), memo('c', 1000, fn)]);
    expect(a).toBe(42);
    expect(b).toBe(42);
    expect(calls).toBe(1);
  });

  it('purge l’entrée si la promesse échoue (retry possible)', async () => {
    let calls = 0;
    const fn = () => { calls++; return Promise.reject(new Error('boom')); };
    await expect(memo('e', 1000, fn)).rejects.toThrow('boom');
    await expect(memo('e', 1000, fn)).rejects.toThrow('boom');
    expect(calls).toBe(2); // pas mis en cache après échec
  });

  it('recalcule après expiration du TTL', async () => {
    let n = 0;
    const fn = () => Promise.resolve(++n);
    expect(await memo('t', 5, fn)).toBe(1);
    await new Promise((r) => setTimeout(r, 15));
    expect(await memo('t', 5, fn)).toBe(2); // entrée périmée → recalcul
  });
});
