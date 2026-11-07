import { apiHandler } from '@/server/api';
import { assistantSettingsGetRoute, assistantSettingsPutRoute } from '@/server/routes/assistant';

export const GET = apiHandler(assistantSettingsGetRoute);
export const PUT = apiHandler(assistantSettingsPutRoute);
