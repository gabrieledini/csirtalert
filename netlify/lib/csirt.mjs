import webpush from 'web-push';
import { getStore } from '@netlify/blobs';

// Uno o più feed separati da virgola in CSIRT_FEED_URL
export const FEED_URLS = (process.env.CSIRT_FEED_URL
  || 'https://csirt.regione.toscana.it/category/alert/feed/')
  .split(',').map(s => s.trim()).filter(Boolean);

const decode = s => s
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ').replace(/&hellip;/g, '…')
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
  .replace(/&amp;/g, '&');

const tag = (b, name) => {
  const m = b.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? decode(m[1]).trim() : '';
};
const plain = html => decode(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const iso = s => { const d = new Date(s); return isNaN(d) ? null : d.toISOString(); };

// Gestisce sia RSS 2.0 (<item>) sia Atom (<entry>)
export function parseFeed(xml) {
  const blocks = xml.match(/<item\b[\s\S]*?<\/item>/gi) || xml.match(/<entry\b[\s\S]*?<\/entry>/gi) || [];
  return blocks.map(b => {
    const href = b.match(/<link\b[^>]*href="([^"]+)"/i);
    const link = href ? decode(href[1]) : tag(b, 'link');
    return {
      id: tag(b, 'guid') || tag(b, 'id') || link,
      title: plain(tag(b, 'title')),
      link,
      date: iso(tag(b, 'pubDate') || tag(b, 'published') || tag(b, 'updated') || tag(b, 'dc:date')),
      summary: plain(tag(b, 'description') || tag(b, 'summary') || tag(b, 'content'))
        .replace(/\s*(L['’]articolo|The post)\s[\s\S]*$/, '')   // coda standard di WordPress
        .replace(/\s*\[(…|\.\.\.)\]\s*$/, '…')
        .slice(0, 400),
    };
  }).filter(i => i.id && i.title);
}

async function fetchOne(url) {
  const r = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; csirt-push/1.0)',
      'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml',
    },
  });
  if (!r.ok) throw new Error(`${url} → HTTP ${r.status}`);
  return parseFeed(await r.text());
}

export async function fetchItems() {
  const res = await Promise.allSettled(FEED_URLS.map(fetchOne));
  res.filter(r => r.status === 'rejected').forEach(r => console.error(r.reason.message));
  const all = res.filter(r => r.status === 'fulfilled').flatMap(r => r.value);
  if (!all.length) throw new Error(res.map(r => r.reason?.message).filter(Boolean).join('; ') || 'feed vuoti o formato non riconosciuto');
  const byLink = new Map();
  for (const i of all) if (!byLink.has(i.link || i.id)) byLink.set(i.link || i.id, i);
  return [...byLink.values()].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
}

export const subsStore = () => getStore('csirt-subs');
export const stateStore = () => getStore('csirt-state');

export function initPush() {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:admin@example.com',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY,
  );
  return webpush;
}

export async function keyOf(endpoint) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint));
  return Buffer.from(h).toString('base64url');
}

export const matches = (item, kw = []) =>
  !kw.length || kw.some(k => `${item.title} ${item.summary}`.toLowerCase().includes(k.toLowerCase()));
