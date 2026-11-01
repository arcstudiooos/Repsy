import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { Toaster } from '@/components/ui/toast';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'Kinetic',
  description: 'Coaching workspace for coaches and their clients.',
  // PRD L1: installable; iOS reads the touch icon and status bar settings from here.
  appleWebApp: { capable: true, title: 'Kinetic', statusBarStyle: 'default' },
  icons: { icon: '/favicon.ico', apple: '/icon-192.png' },
};

export const viewport: Viewport = { themeColor: '#1c7666' };

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
