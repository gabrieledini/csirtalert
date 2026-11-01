import { subsStore, keyOf, initPush } from '../lib/csirt.mjs';

export default async (req) => {
  if (req.method === 'GET') return Response.json({ publicKey: process.env.VAPID_PUBLIC_KEY || null });

  const { action, subscription, keywords = [] } = await req.json().catch(() => ({}));
  if (!subscription?.endpoint) return Response.json({ error: 'subscription mancante' }, { status: 400 });

  const store = subsStore();
  const key = await keyOf(subscription.endpoint);

  try {
    if (action === 'subscribe') {
      const kw = keywords.map(s => String(s).trim()).filter(Boolean).slice(0, 20);
      await store.setJSON(key, { subscription, keywords: kw, created: new Date().toISOString() });
      return Response.json({ ok: true, keywords: kw });
    }
    if (action === 'unsubscribe') {
      await store.delete(key);
      return Response.json({ ok: true });
    }
    if (action === 'test') {
      await initPush().sendNotification(subscription, JSON.stringify({
        title: 'CSIRT Italia: notifica di prova',
        body: 'Le notifiche funzionano. Riceverai qui i nuovi avvisi.',
        url: '/', tag: 'csirt-test',
      }));
      return Response.json({ ok: true });
    }
    return Response.json({ error: 'azione sconosciuta' }, { status: 400 });
  } catch (e) {
    return Response.json({ error: e.body || e.message }, { status: e.statusCode || 500 });
  }
};

export const config = { path: '/api/push' };
