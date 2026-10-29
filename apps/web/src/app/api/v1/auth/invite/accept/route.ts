import { apiHandler } from '@/server/api';
import { inviteAcceptRoute } from '@/server/routes/inviteAccept';

export const POST = apiHandler(inviteAcceptRoute);
