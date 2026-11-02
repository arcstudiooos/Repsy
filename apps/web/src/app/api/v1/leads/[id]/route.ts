import { apiHandler } from '@/server/api';
import { leadPatchRoute } from '@/server/routes/leads';

export const PATCH = apiHandler(leadPatchRoute);
