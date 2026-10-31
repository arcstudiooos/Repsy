import { apiHandler } from '@/server/api';
import { checkinTemplateGetRoute, checkinTemplatePatchRoute } from '@/server/routes/checkins';

export const GET = apiHandler(checkinTemplateGetRoute);
export const PATCH = apiHandler(checkinTemplatePatchRoute);
