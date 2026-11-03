import { apiHandler } from '@/server/api';
import { lapseGetRoute, lapsePostRoute } from '@/server/routes/lapse';

export const GET = apiHandler(lapseGetRoute);
export const POST = apiHandler(lapsePostRoute);
