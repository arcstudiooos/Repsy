import { apiHandler } from '@/server/api';
import { joinLinkDeleteRoute } from '@/server/routes/joinLinks';

export const DELETE = apiHandler(joinLinkDeleteRoute);
