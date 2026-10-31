import { apiHandler } from '@/server/api';
import { checkinGetRoute } from '@/server/routes/checkins';

export const GET = apiHandler(checkinGetRoute);
