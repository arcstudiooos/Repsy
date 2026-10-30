import { apiHandler } from '@/server/api';
import { clientThreadRoute } from '@/server/routes/messages';

export const GET = apiHandler(clientThreadRoute);
