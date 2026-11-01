import { apiHandler } from '@/server/api';
import { checkinTemplatesListRoute, checkinTemplatesPostRoute } from '@/server/routes/checkins';

export const GET = apiHandler(checkinTemplatesListRoute);
export const POST = apiHandler(checkinTemplatesPostRoute);
