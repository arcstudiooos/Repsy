import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { assertSafeKey, type StoragePort } from './port';

/** Local and test storage: files under `root` (default `<repo>/.dev-exports`, like the email dev sink). */
export function createFsStorage(root: string): StoragePort {
  const path = (key: string) => {
    assertSafeKey(key);
    return join(root, key);
  };
  return {
    async put(key, body) {
      const p = path(key);
      await mkdir(dirname(p), { recursive: true });
      await writeFile(p, body, 'utf8');
    },
    async read(key) {
      try {
        return await readFile(path(key));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      }
    },
    async deleteMany(keys) {
      for (const key of keys) await rm(path(key), { force: true });
    },
  };
}
