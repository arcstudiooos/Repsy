import { apiHandler } from '@/server/api';
import { adminNoticePostRoute } from '@/server/routes/privacy';

export const POST = apiHandler(adminNoticePostRoute);
