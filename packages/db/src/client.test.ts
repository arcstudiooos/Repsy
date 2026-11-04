import { describe, expect, it } from 'vitest';
import { transactionOptionsFromEnv } from './client';

describe('transactionOptionsFromEnv', () => {
  it('keeps Prisma defaults unless a positive whole number is set', () => {
    expect(transactionOptionsFromEnv({})).toEqual({});
    expect(transactionOptionsFromEnv({ DB_TX_MAX_WAIT_MS: '', DB_TX_TIMEOUT_MS: 'abc' })).toEqual(
      {},
    );
    expect(transactionOptionsFromEnv({ DB_TX_TIMEOUT_MS: '-5' })).toEqual({});
    expect(
      transactionOptionsFromEnv({ DB_TX_MAX_WAIT_MS: '10000', DB_TX_TIMEOUT_MS: '20000' }),
    ).toEqual({
      maxWait: 10000,
      timeout: 20000,
    });
  });
});
