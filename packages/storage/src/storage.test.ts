import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createFsStorage, createStorage } from './index';

const dirs: string[] = [];
afterAll(async () => {
  for (const d of dirs) await rm(d, { recursive: true, force: true });
});

describe('fs storage', () => {
  it('puts, reads, deletes; missing keys read as null; unsafe keys are refused', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'repsy-storage-'));
    dirs.push(dir);
    const s = createFsStorage(dir);
    await s.put('exports/o/j/clients.csv', 'a,b\n', 'text/csv');
    expect((await s.read('exports/o/j/clients.csv'))?.toString()).toBe('a,b\n');
    await s.deleteMany(['exports/o/j/clients.csv', 'exports/o/j/none.csv']);
    expect(await s.read('exports/o/j/clients.csv')).toBeNull();
    await expect(s.put('../escape.csv', 'x', 'text/csv')).rejects.toThrow(/Invalid storage key/);
    await expect(s.read('/etc/passwd')).rejects.toThrow(/Invalid storage key/);
  });

  it('createStorage needs S3 in production and complete S3 credentials', () => {
    expect(() => createStorage({ NODE_ENV: 'production' })).toThrow(/S3_BUCKET is required/);
    expect(() => createStorage({ S3_BUCKET: 'b' })).toThrow(/S3_ACCESS_KEY_ID/);
  });
});
