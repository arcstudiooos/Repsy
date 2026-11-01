import { apiHandler } from '@/server/api';
import { adminNoticeResolveRoute } from '@/server/routes/privacy';

export const PATCH = apiHandler(adminNoticeResolveRoute);
