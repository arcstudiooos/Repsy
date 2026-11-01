import { apiHandler } from '@/server/api';
import { supportPostRoute } from '@/server/routes/support';

export const POST = apiHandler(supportPostRoute);
