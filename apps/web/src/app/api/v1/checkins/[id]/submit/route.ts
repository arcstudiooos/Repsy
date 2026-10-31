import { apiHandler } from '@/server/api';
import { checkinSubmitRoute } from '@/server/routes/checkins';

export const POST = apiHandler(checkinSubmitRoute);
