import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'دوئل اندیشه | Duel of Thought',
  description: 'دوئل اندیشه — ساختهٔ اندیشه‌نگاران فردای شرق | Duel of Thought by Thoughtkeepers of Tomorrow’s East — a science-backed mind games park',
  manifest: '/manifest.webmanifest',
  applicationName: 'Duel of Thought',
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'Duel of Thought' },
  icons: {
    icon: [{ url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }],
    apple: [{ url: '/icons/icon-192.png' }],
  },
};

export const viewport: Viewport = {
  themeColor: '#1e1145',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fa" dir="rtl" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* Vazirmatn covers Persian/Arabic + Latin; fallbacks keep it usable offline */}
        <link
          href="https://fonts.googleapis.com/css2?family=Vazirmatn:wght@400;500;700;900&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
