import { apiHandler } from '@/server/api';
import { leadConvertRoute } from '@/server/routes/leads';

export const POST = apiHandler(leadConvertRoute);
