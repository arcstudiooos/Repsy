import { apiHandler } from '@/server/api';
import { billingSettingsGetRoute, billingSettingsPutRoute } from '@/server/routes/billing';

export const GET = apiHandler(billingSettingsGetRoute);
export const PUT = apiHandler(billingSettingsPutRoute);
