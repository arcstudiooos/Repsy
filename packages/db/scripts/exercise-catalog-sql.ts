// Prints the catalog INSERT for the exercises migration:
//   pnpm --filter @kinetic/db exercises:sql
import { renderCatalogInsert } from '../src/exercises/catalogSql';

process.stdout.write(renderCatalogInsert());
