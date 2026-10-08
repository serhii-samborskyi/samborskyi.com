import TokenAction from '@/components/token-action';
export const metadata = { title: 'Unsubscribe', robots: { index: false, follow: false } };
export default async function Unsubscribe({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  return <TokenAction mode="unsubscribe" value={token || ''} />;
}
