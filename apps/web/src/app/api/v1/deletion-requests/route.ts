import { apiHandler } from '@/server/api';
import { deletionRequestPostRoute } from '@/server/routes/privacy';

export const POST = apiHandler(deletionRequestPostRoute);
