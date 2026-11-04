import type { Metadata, Viewport } from 'next';
import { Geist_Mono, Plus_Jakarta_Sans } from 'next/font/google';
import { Toaster } from '@/components/ui/toast';
import './globals.css';

// Modern geometric sans for the whole product (ui-ux-pro-max: SaaS, dashboards, friendly and professional).
const sans = Plus_Jakarta_Sans({
  variable: '--font-sans-brand',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: { default: 'Repsy.fit', template: '%s' },
  description: 'Repsy.fit: the coaching workspace for coaches and their clients.',
  // PRD L1: installable; iOS reads the touch icon and status bar settings from here.
  appleWebApp: { capable: true, title: 'Repsy', statusBarStyle: 'default' },
  icons: { icon: '/favicon.ico', apple: '/icon-192.png' },
};

export const viewport: Viewport = { themeColor: '#4f46e5' };

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className={`${sans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
