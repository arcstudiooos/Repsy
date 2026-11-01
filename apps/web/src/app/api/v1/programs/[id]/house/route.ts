import { apiHandler } from '@/server/api';
import { programHouseRoute } from '@/server/routes/programs';

export const PUT = apiHandler(programHouseRoute);
