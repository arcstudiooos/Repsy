import { apiHandler } from '@/server/api';
import { packageOnboardingRoute } from '@/server/routes/scheduling';

export const POST = apiHandler(packageOnboardingRoute);
