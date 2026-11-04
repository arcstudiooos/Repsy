import { apiHandler } from '@/server/api';
import { packsListRoute, packsPostRoute } from '@/server/routes/scheduling';

export const GET = apiHandler(packsListRoute);
export const POST = apiHandler(packsPostRoute);
