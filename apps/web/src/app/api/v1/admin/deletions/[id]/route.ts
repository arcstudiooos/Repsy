import { apiHandler } from '@/server/api';
import { adminDeletionPatchRoute } from '@/server/routes/privacy';

export const PATCH = apiHandler(adminDeletionPatchRoute);
