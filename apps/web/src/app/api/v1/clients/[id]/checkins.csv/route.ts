import { apiHandler } from '@/server/api';
import { checkinResponsesCsvRoute } from '@/server/routes/checkins';

export const GET = apiHandler(checkinResponsesCsvRoute);
