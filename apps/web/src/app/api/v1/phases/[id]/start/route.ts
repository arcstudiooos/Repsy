import { apiHandler } from '@/server/api';
import { phaseStartRoute } from '@/server/routes/phases';

export const POST = apiHandler(phaseStartRoute);
