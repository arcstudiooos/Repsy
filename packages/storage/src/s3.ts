import {
  DeleteObjectsCommand,
  GetObjectCommand,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { assertSafeKey, type StoragePort } from './port';

export interface S3Config {
  endpoint?: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  region?: string;
}

/** S3-compatible private bucket (production). Objects are server-side encrypted and never public. */
export function createS3Storage(config: S3Config): StoragePort {
  const client = new S3Client({
    region: config.region ?? 'auto',
    ...(config.endpoint ? { endpoint: config.endpoint, forcePathStyle: true } : {}),
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
  });
  return {
    async put(key, body, contentType) {
      assertSafeKey(key);
      await client.send(
        new PutObjectCommand({
          Bucket: config.bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
          ServerSideEncryption: 'AES256',
        }),
      );
    },
    async read(key) {
      assertSafeKey(key);
      try {
        const res = await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: key }));
        return res.Body ? Buffer.from(await res.Body.transformToByteArray()) : null;
      } catch (error) {
        if (error instanceof NoSuchKey) return null;
        throw error;
      }
    },
    async deleteMany(keys) {
      if (keys.length === 0) return;
      keys.forEach(assertSafeKey);
      await client.send(
        new DeleteObjectsCommand({
          Bucket: config.bucket,
          Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
        }),
      );
    },
  };
}
