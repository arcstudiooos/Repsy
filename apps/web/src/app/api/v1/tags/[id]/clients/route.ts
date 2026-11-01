import { apiHandler } from '@/server/api';
import { tagClientsPostRoute } from '@/server/routes/tags';

export const POST = apiHandler(tagClientsPostRoute);
