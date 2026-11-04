import { apiHandler } from '@/server/api';
import { lapseGetRoute } from '@/server/routes/lapse';

export const GET = apiHandler(lapseGetRoute);
