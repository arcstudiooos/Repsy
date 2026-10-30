import { join } from 'node:path';
import { createFsStorage } from './fs';
import type { StoragePort } from './port';
import { createS3Storage } from './s3';

export { createFsStorage } from './fs';
export { createS3Storage, type S3Config } from './s3';
export { assertSafeKey, type StoragePort } from './port';

type Env = Record<string, string | undefined>;

/**
 * S3 when S3_BUCKET is set (all S3_* required then), otherwise files under DEV_EXPORT_DIR (blank =
 * `<repo>/.dev-exports`). Production refuses the filesystem fallback.
 */
export function createStorage(env: Env = process.env, repoRoot = process.cwd()): StoragePort {
  const bucket = env.S3_BUCKET?.trim();
  if (bucket) {
    const accessKeyId = env.S3_ACCESS_KEY_ID?.trim();
    const secretAccessKey = env.S3_SECRET_ACCESS_KEY?.trim();
    if (!accessKeyId || !secretAccessKey) {
      throw new Error('S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY are required with S3_BUCKET');
    }
    return createS3Storage({
      bucket,
      accessKeyId,
      secretAccessKey,
      endpoint: env.S3_ENDPOINT?.trim() || undefined,
      region: env.S3_REGION?.trim() || undefined,
    });
  }
  if (env.NODE_ENV === 'production') {
    throw new Error('S3_BUCKET is required in production (exports need private object storage)');
  }
  return createFsStorage(env.DEV_EXPORT_DIR?.trim() || join(repoRoot, '.dev-exports'));
}
