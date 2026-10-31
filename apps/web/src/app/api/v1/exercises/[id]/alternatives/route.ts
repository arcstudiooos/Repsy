import { apiHandler } from '@/server/api';
import {
  exerciseAlternativesGetRoute,
  exerciseAlternativesPutRoute,
} from '@/server/routes/exercises';

export const GET = apiHandler(exerciseAlternativesGetRoute);
export const PUT = apiHandler(exerciseAlternativesPutRoute);
