import { z } from 'zod';
import {
  archiveCourse,
  endEnrollment,
  enrollClient,
  saveCourse,
  setLessonDone,
} from '@kinetic/core';
import { ApiResult, type RouteDef } from '../api';

const lesson = z.object({
  id: z.string().max(64).optional(),
  title: z.string().max(500),
  body: z.string().max(40_000).optional(),
  url: z.string().max(2000).nullable().optional(),
});
const courseSchema = z.object({
  title: z.string().max(500),
  description: z.string().max(5000).optional(),
  cadence: z.string().max(20),
  lessons: z.array(lesson).max(100),
});

/** `POST /api/v1/courses` (PRD G4): a new course with its lessons. */
export const coursesPostRoute: RouteDef<typeof courseSchema, true> = {
  can: 'client:update',
  input: courseSchema,
  handler: async ({ actor, input, requestId, tenant }) =>
    new ApiResult(await tenant((tx) => saveCourse(tx, actor, input, { requestId })), {
      status: 201,
    }),
};

/** `PUT /api/v1/courses/:id`: replace its details and lessons. */
export const coursePutRoute: RouteDef<typeof courseSchema, true> = {
  can: 'client:update',
  input: courseSchema,
  handler: ({ actor, input, params, requestId, tenant }) =>
    tenant((tx) => saveCourse(tx, actor, { ...input, id: params.id }, { requestId })),
};

/** `DELETE /api/v1/courses/:id`: archive it (enrolments end). */
export const courseDeleteRoute: RouteDef<undefined, true> = {
  can: 'client:update',
  handler: async ({ actor, params, requestId, tenant }) => {
    await tenant((tx) => archiveCourse(tx, actor, params.id ?? '', { requestId }));
    return new ApiResult(null, { status: 204 });
  },
};

const enrollSchema = z.object({
  clientId: z.string().max(64),
  startLocalDate: z.string().max(20).optional(),
});

/** `POST /api/v1/courses/:id/enrollments`: enrol a client. */
export const courseEnrollRoute: RouteDef<typeof enrollSchema, true> = {
  can: 'client:update',
  input: enrollSchema,
  handler: async ({ actor, input, params, requestId, tenant }) =>
    new ApiResult(
      await tenant((tx) =>
        enrollClient(tx, actor, { ...input, courseId: params.id }, { requestId }),
      ),
      { status: 201 },
    ),
};

/** `DELETE /api/v1/course-enrollments/:id`: take the course off the client's portal. */
export const enrollmentDeleteRoute: RouteDef<undefined, true> = {
  can: 'client:update',
  handler: async ({ actor, params, requestId, tenant }) => {
    await tenant((tx) => endEnrollment(tx, actor, params.id ?? '', { requestId }));
    return new ApiResult(null, { status: 204 });
  },
};

const doneSchema = z.object({ done: z.boolean() });

/** `PUT /api/v1/course-enrollments/:id/lessons/:lessonId`: the client marks a lesson done or not. */
export const lessonDoneRoute: RouteDef<typeof doneSchema, true> = {
  can: 'session:log',
  input: doneSchema,
  handler: async ({ actor, input, params, tenant }) => {
    await tenant((tx) =>
      setLessonDone(tx, actor, {
        enrollmentId: params.id,
        lessonId: params.lessonId,
        done: input.done,
      }),
    );
    return { done: input.done };
  },
};
