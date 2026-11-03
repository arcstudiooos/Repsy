import { apiHandler } from '@/server/api';
import { aiSettingGetRoute, aiSettingPutRoute } from '@/server/routes/aiDrafts';

export const GET = apiHandler(aiSettingGetRoute);
export const PUT = apiHandler(aiSettingPutRoute);
