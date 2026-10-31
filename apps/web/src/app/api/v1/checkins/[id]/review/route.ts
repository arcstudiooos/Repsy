import { apiHandler } from '@/server/api';
import { checkinReviewRoute } from '@/server/routes/checkins';

export const POST = apiHandler(checkinReviewRoute);
