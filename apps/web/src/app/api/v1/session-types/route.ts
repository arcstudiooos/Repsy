import { apiHandler } from '@/server/api';
import { sessionTypesGetRoute, sessionTypesPostRoute } from '@/server/routes/scheduling';

export const GET = apiHandler(sessionTypesGetRoute);
export const POST = apiHandler(sessionTypesPostRoute);
