import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { siteOrigin } from '@/lib/site-origin';
import { configuration } from '@/lib/integrations';
import ReleasePage from '@/components/release-page';
import type { Release } from '@/lib/types';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
async function getRelease(id: string) {
  const row = (await db()
    .prepare("SELECT * FROM releases WHERE id=? AND status='published'")
    .get(id)) as Release | undefined;
  return row ? { ...row } : undefined;
}
export async function generateMetadata({
  params,
}: {
  params: Promise<{
    id: string;
  }>;
}) {
  const { id } = await params;
  const r = await getRelease(id);
  if (!r) return { title: 'Release not found' };
  const base = new URL(siteOrigin());
  const image = r.artwork_id ? new URL(`/api/media/${r.artwork_id}`, base).href : null;
  return {
    title: r.title,
    description: r.description,
    openGraph: {
      title: r.title,
      description: r.description,
      type: 'music.song',
      url: new URL(`/listen/${r.id}`, base).href,
      images: image ? [{ url: image }] : [],
    },
    twitter: {
      card: image ? 'summary_large_image' : 'summary',
      title: r.title,
      description: r.description,
      images: image ? [image] : [],
    },
  };
}
export default async function Listen({
  params,
}: {
  params: Promise<{
    id: string;
  }>;
}) {
  const { id } = await params;
  const r = await getRelease(id);
  if (!r) notFound();
  return <ReleasePage release={r} config={configuration()} />;
}
