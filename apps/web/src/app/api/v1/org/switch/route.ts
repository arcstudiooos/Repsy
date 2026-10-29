import { apiHandler } from '@/server/api';
import { orgSwitchRoute } from '@/server/routes/orgSwitch';

export const POST = apiHandler(orgSwitchRoute);
