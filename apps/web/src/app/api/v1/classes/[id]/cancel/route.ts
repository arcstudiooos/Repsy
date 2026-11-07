import { apiHandler } from '@/server/api';
import { classCancelRoute } from '@/server/routes/locationsClasses';

export const POST = apiHandler(classCancelRoute);
