import { fetchItems } from '../lib/csirt.mjs';

export default async () => {
  try {
    const items = await fetchItems();
    return Response.json({ items: items.slice(0, 30) }, { headers: { 'Cache-Control': 'public, max-age=300' } });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 502 });
  }
};

export const config = { path: '/api/feed' };
