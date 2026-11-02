import { z } from 'zod';
import {
  deleteProgressReport,
  progressReportData,
  renderProgressReport,
  saveProgressReport,
} from '@kinetic/core';
import { ApiResult, type RouteDef } from '../api';
import { exportStorage } from './exports';

const schema = z.object({
  month: z.string().max(10),
  summary: z.string().max(8000).optional(),
  includePhotos: z.boolean().optional(),
});

/** `POST /api/v1/clients/:id/progress-reports` (PRD E10): create (or update) a month's report. */
export const progressReportPostRoute: RouteDef<typeof schema, true> = {
  can: 'client:update',
  input: schema,
  handler: async ({ actor, input, params, requestId, tenant }) => {
    const report = await tenant((tx) =>
      saveProgressReport(tx, actor, { ...input, clientId: params.id }, { requestId }),
    );
    return new ApiResult(report, { status: report.created ? 201 : 200 });
  },
};

/** `DELETE /api/v1/progress-reports/:id`. */
export const progressReportDeleteRoute: RouteDef<undefined, true> = {
  can: 'client:update',
  handler: async ({ actor, params, requestId, tenant }) => {
    await tenant((tx) => deleteProgressReport(tx, actor, params.id ?? '', { requestId }));
    return new ApiResult(null, { status: 204 });
  },
};

/**
 * `GET /api/v1/progress-reports/:id/pdf`: the report, built now from the client's data, for the client and their
 * coaches only. Photos are read from private storage into the file; nothing is cached by shared caches.
 */
export const progressReportPdfRoute: RouteDef<undefined, true> = {
  can: 'metric:read',
  rateLimit: { capacity: 20, refillPerSecond: 20 / 600 },
  handler: async ({ actor, params, tenant }) => {
    const data = await tenant((tx) => progressReportData(tx, actor, params.id ?? ''));
    const storage = exportStorage.get();
    const images = new Map<string, Uint8Array>();
    for (const p of data.photos) {
      const bytes = await storage.read(p.storageKey).catch(() => null);
      if (bytes) images.set(p.storageKey, new Uint8Array(bytes));
    }
    const pdf = renderProgressReport(data, images);
    return new Response(new Uint8Array(pdf), {
      status: 200,
      headers: {
        'content-type': 'application/pdf',
        'content-length': String(pdf.length),
        'cache-control': 'private, no-store',
        'x-content-type-options': 'nosniff',
        'content-disposition': `attachment; filename="progress-report-${data.month}.pdf"`,
      },
    });
  },
};
