import { apiHandler } from '@/server/api';
import { clientFormPostRoute } from '@/server/routes/checkins';

export const POST = apiHandler(clientFormPostRoute);
