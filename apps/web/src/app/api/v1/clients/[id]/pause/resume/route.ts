import { apiHandler } from '@/server/api';
import { clientResumeRoute } from '@/server/routes/clients';

export const POST = apiHandler(clientResumeRoute);
