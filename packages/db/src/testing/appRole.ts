import { readFileSync } from 'node:fs';
import type pg from 'pg';

const sql = readFileSync(new URL('../../sql/app-role.sql', import.meta.url), 'utf8');

export interface AppRoleOptions {
  role: string;
  password: string;
  appSchema: string;
  pgbossSchema: string;
}

/** Applies packages/db/sql/app-role.sql on an admin connection, as psql would via PGOPTIONS. */
export async function applyAppRoleSql(admin: pg.Client, options: AppRoleOptions): Promise<void> {
  const set = (name: string, value: string) =>
    admin.query('SELECT set_config($1, $2, false)', [name, value]);
  await set('repsy.app_role', options.role);
  await set('repsy.app_password', options.password);
  await set('repsy.app_schema', options.appSchema);
  await set('repsy.pgboss_schema', options.pgbossSchema);
  await admin.query(sql);
}

/** Removes a role created by applyAppRoleSql and the pg-boss schema it provisioned. */
export async function dropAppRole(
  admin: pg.Client,
  options: Pick<AppRoleOptions, 'role' | 'pgbossSchema'>,
): Promise<void> {
  await admin.query(`DROP SCHEMA IF EXISTS "${options.pgbossSchema}" CASCADE`);
  await admin.query(`DROP OWNED BY "${options.role}"`);
  await admin.query(`DROP ROLE IF EXISTS "${options.role}"`);
}
