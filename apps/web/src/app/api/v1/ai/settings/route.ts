import { apiHandler } from '@/server/api';
import { aiSettingsGetRoute, aiSettingsPutRoute } from '@/server/routes/ai';

export const GET = apiHandler(aiSettingsGetRoute);
export const PUT = apiHandler(aiSettingsPutRoute);
