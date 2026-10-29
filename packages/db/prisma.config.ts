import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: process.env.DATABASE_URL ?? '',
    // Used by `migrate dev` and `db:diff` (replays migrations in a scratch database).
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL,
  },
});
