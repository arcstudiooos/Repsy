import { apiHandler } from '@/server/api';
import { phaseDeleteRoute } from '@/server/routes/phases';

export const DELETE = apiHandler(phaseDeleteRoute);
