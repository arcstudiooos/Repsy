import { apiHandler } from '@/server/api';
import { clientCheckinSchedulePutRoute } from '@/server/routes/checkins';

export const PUT = apiHandler(clientCheckinSchedulePutRoute);
