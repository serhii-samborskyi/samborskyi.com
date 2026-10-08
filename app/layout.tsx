import type { Metadata } from 'next';
import '@fontsource-variable/dm-sans';
import '@fontsource-variable/manrope';
import './globals.css';
import { siteOrigin } from '@/lib/site-origin';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return {
    metadataBase: new URL(siteOrigin()),
    icons: { icon: '/serhii-cover.png', apple: '/serhii-cover.png' },
    title: { default: 'Serhii Samborskyi — A place for sound', template: '%s — Serhii Samborskyi' },
    description:
      'An independent listening room by composer Serhii Samborskyi. Music experiments, works in progress, and sounds worth sitting with.',
    openGraph: {
      title: 'Serhii Samborskyi — A place for sound',
      description: 'Music experiments. Unfiltered ideas. A little space to listen.',
      images: [{ url: '/serhii-cover.png', width: 1254, height: 1254, alt: 'Serhii Samborskyi' }],
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title: 'Serhii Samborskyi — A place for sound',
      description: 'Music experiments. Unfiltered ideas. A little space to listen.',
      images: ['/serhii-cover.png'],
    },
  };
}
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
