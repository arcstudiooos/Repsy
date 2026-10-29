import { meResponse } from '@/lib/me';

export function GET(request: Request): Promise<Response> {
  return meResponse(request.headers);
}
