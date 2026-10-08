import TokenAction from '@/components/token-action';
export const metadata = {
  title: 'Confirm your subscription',
  robots: { index: false, follow: false },
};
export default async function Confirm({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  return <TokenAction mode="confirm" value={token || ''} />;
}
