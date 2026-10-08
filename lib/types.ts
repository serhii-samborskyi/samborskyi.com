export type Release = {
  id: string;
  title: string;
  description: string;
  category: string;
  duration: number;
  audio_id: string;
  artwork_id: string | null;
  status: 'draft' | 'published';
  created_at: number;
  published_at: number | null;
};
export type PublicConfig = {
  email: boolean;
  telegram: string | null;
  pushKey: string | null;
  pixelId: string | null;
};
export type Upload = {
  id: string;
  filename: string;
  mime: string;
  size: number;
  kind: 'audio' | 'image';
};
export type Subscriber = {
  id: string;
  channel: 'email' | 'telegram' | 'push';
  address: string;
  status: string;
  data: string | null;
  confirm_nonce: string;
  created_at: number;
  confirmed_at: number | null;
};
export type Job = {
  id: string;
  release_id: string;
  subscriber_id: string;
  status: string;
  attempts: number;
  last_error: string | null;
};
