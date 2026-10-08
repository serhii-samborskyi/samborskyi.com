import ListeningRoom from '@/components/listening-room';
import { configuration } from '@/lib/integrations';
import { publicReleases } from '@/lib/releases';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export default async function Home() {
  return <ListeningRoom releases={await publicReleases()} config={configuration()} />;
}
