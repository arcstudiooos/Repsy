import type { Metadata } from 'next';
import { SupportPage } from '@/components/support/SupportPage';

export const metadata: Metadata = { title: 'Help and support | Repsy' };

export default function CoachSupport() {
  return <SupportPage coach />;
}
