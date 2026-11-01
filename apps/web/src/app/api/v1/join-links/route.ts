import { apiHandler } from '@/server/api';
import { joinLinksListRoute, joinLinksPostRoute } from '@/server/routes/joinLinks';

export const GET = apiHandler(joinLinksListRoute);
export const POST = apiHandler(joinLinksPostRoute);
