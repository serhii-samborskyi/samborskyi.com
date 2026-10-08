import type { MetadataRoute } from 'next';
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Serhii Samborskyi — Listening room',
    short_name: 'Samborskyi',
    description: 'Music experiments and new sounds from Serhii Samborskyi.',
    start_url: '/',
    display: 'standalone',
    background_color: '#10100f',
    theme_color: '#10100f',
    icons: [{ src: '/serhii-cover.png', sizes: '1254x1254', type: 'image/png', purpose: 'any' }],
  };
}
