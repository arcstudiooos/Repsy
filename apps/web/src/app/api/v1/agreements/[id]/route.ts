import { apiHandler } from '@/server/api';
import { agreementDeleteRoute, agreementPatchRoute } from '@/server/routes/agreements';

export const PATCH = apiHandler(agreementPatchRoute);
export const DELETE = apiHandler(agreementDeleteRoute);
