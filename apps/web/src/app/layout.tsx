import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { themeBootScript } from '@/components/theme/theme';
import { Toaster } from '@/components/ui/toast';
import { appUrl, SITE_NAME } from '@/lib/site';
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
  // Relative canonicals and the generated share image resolve against the app host, where every page but the
  // landing page lives (SEO/AEO audit 2026-11-06). The landing page sets an absolute canonical on the marketing host.
  metadataBase: new URL(appUrl),
  title: 'Repsy',
  description: 'Coaching workspace for coaches and their clients.',
  applicationName: SITE_NAME,
  openGraph: { siteName: SITE_NAME, locale: 'en_US', type: 'website' },
  twitter: { card: 'summary_large_image' },
  // PRD L1: installable; iOS reads the touch icon and status bar settings from here.
  appleWebApp: { capable: true, title: 'Repsy', statusBarStyle: 'default' },
  icons: { icon: '/favicon.ico', apple: '/icon-192.png' },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#F5F5FF' },
    { media: '(prefers-color-scheme: dark)', color: '#0E0F1A' },
  ],
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    // data-theme is set by the boot script before React hydrates (no flash of the wrong theme).
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
      </head>
      <body className="min-h-full flex flex-col">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
