'use client';

import dynamic from 'next/dynamic';
import { LoadingState } from '@/components/states/LoadingState';

/** The check-in form reads the device draft from localStorage, so it renders in the browser only. */
export const CheckinFormLoader = dynamic(() => import('./CheckinForm').then((m) => m.CheckinForm), {
  ssr: false,
  loading: () => <LoadingState />,
});
