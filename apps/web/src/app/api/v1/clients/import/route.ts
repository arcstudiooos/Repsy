import { apiHandler } from '@/server/api';
import { clientsImportRoute } from '@/server/routes/clients';

export const POST = apiHandler(clientsImportRoute);
