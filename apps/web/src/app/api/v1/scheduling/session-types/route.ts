import { apiHandler } from '@/server/api';
import { sessionTypesListRoute, sessionTypesPostRoute } from '@/server/routes/scheduling';

export const GET = apiHandler(sessionTypesListRoute);
export const POST = apiHandler(sessionTypesPostRoute);
