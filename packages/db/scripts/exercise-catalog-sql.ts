// Prints the catalog INSERT for the exercises migration:
//   pnpm --filter @repsy/db exercises:sql
import { renderCatalogInsert } from '../src/exercises/catalogSql';

process.stdout.write(renderCatalogInsert());
