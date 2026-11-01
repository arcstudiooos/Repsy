import { apiHandler } from '@/server/api';
import { agreementsListRoute, agreementsPostRoute } from '@/server/routes/agreements';

export const GET = apiHandler(agreementsListRoute);
export const POST = apiHandler(agreementsPostRoute);
