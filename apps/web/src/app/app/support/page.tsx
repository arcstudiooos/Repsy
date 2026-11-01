import type { Metadata } from 'next';
import { SupportPage } from '@/components/support/SupportPage';

export const metadata: Metadata = { title: 'Help and support | Kinetic' };

export default function CoachSupport() {
  return <SupportPage coach />;
}
