import { apiHandler } from '@/server/api';
import { groupReportRoute } from '@/server/routes/groups';

export const POST = apiHandler(groupReportRoute);
