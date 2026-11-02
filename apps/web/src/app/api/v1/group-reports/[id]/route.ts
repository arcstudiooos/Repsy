import { apiHandler } from '@/server/api';
import { groupReportDismissRoute } from '@/server/routes/groups';

export const DELETE = apiHandler(groupReportDismissRoute);
