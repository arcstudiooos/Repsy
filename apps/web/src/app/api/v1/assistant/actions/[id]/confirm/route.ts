import { apiHandler } from '@/server/api';
import { assistantActionConfirmRoute } from '@/server/routes/assistant';

export const POST = apiHandler(assistantActionConfirmRoute);
