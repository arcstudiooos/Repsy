import { apiHandler } from '@/server/api';
import { settingsGetRoute, settingsPatchRoute } from '@/server/routes/settings';

export const GET = apiHandler(settingsGetRoute);
export const PATCH = apiHandler(settingsPatchRoute);
