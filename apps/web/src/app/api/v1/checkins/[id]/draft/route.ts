import { apiHandler } from '@/server/api';
import { checkinDraftPutRoute } from '@/server/routes/checkins';

export const PUT = apiHandler(checkinDraftPutRoute);
