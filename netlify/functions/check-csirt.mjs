import { fetchItems, stateStore, subsStore, initPush, matches } from '../lib/csirt.mjs';

const payloads = list => list.length <= 3
  ? list.map(i => ({ title: i.title, body: i.summary || 'Nuovo avviso CSIRT Italia', url: i.link || '/', tag: i.id }))
  : [{ title: `CSIRT Italia: ${list.length} nuovi avvisi`, body: list.map(i => '• ' + i.title).join('\n').slice(0, 300), url: '/', tag: 'csirt-batch' }];

export default async () => {
  const st = stateStore();
  const prev = await st.get('seen', { type: 'json' });
  const items = await fetchItems();

  // Primo giro: memorizza lo stato senza notificare lo storico
  if (!prev) {
    await st.setJSON('seen', { ids: items.map(i => i.id), at: new Date().toISOString() });
    console.log(`seed: ${items.length} avvisi`);
    return;
  }

  const seen = new Set(prev.ids);
  const fresh = items.filter(i => !seen.has(i.id)).reverse(); // dal più vecchio
  console.log(`nuovi avvisi: ${fresh.length}`);

  if (fresh.length) {
    const wp = initPush();
    const store = subsStore();
    const { blobs } = await store.list();
    for (const { key } of blobs) {
      const rec = await store.get(key, { type: 'json' });
      if (!rec) continue;
      const mine = fresh.filter(i => matches(i, rec.keywords));
      for (const p of payloads(mine)) {
        try {
          await wp.sendNotification(rec.subscription, JSON.stringify(p), { TTL: 86400 });
        } catch (e) {
          if (e.statusCode === 404 || e.statusCode === 410) { await store.delete(key); break; }
          console.error('push fallita', e.statusCode, e.body);
        }
      }
    }
  }

  const ids = [...new Set([...items.map(i => i.id), ...prev.ids])].slice(0, 500);
  await st.setJSON('seen', { ids, at: new Date().toISOString() });
};

export const config = { schedule: '*/15 * * * *' };
