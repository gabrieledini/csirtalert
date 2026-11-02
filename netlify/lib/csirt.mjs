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
      id: link || tag(b, 'guid') || tag(b, 'id'),
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

const MESI = { gennaio: 0, febbraio: 1, marzo: 2, aprile: 3, maggio: 4, giugno: 5, luglio: 6, agosto: 7, settembre: 8, ottobre: 9, novembre: 10, dicembre: 11 };
const dataIt = t => {
  const m = t.match(/(\d{1,2})\s+(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)\s+(\d{4})/i);
  return m ? new Date(Date.UTC(+m[3], MESI[m[2].toLowerCase()], +m[1], 12)).toISOString() : null;
};

// Ripiego: legge gli articoli dalla pagina HTML di un sito WordPress (titoli in h2–h5 con link)
export function parseWpHtml(html, pageUrl) {
  const host = new URL(pageUrl).host;
  const re = /<h[2-5][^>]*>\s*<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>\s*<\/h[2-5]>/gi;
  const hits = [...html.matchAll(re)];
  const out = [];
  hits.forEach((m, k) => {
    let u; try { u = new URL(decode(m[1]), pageUrl); } catch { return; }
    if (u.host !== host || u.pathname === '/' || /^\/(category|tag|contenuti|page|author)\//.test(u.pathname)) return;
    const before = html.slice(k ? hits[k - 1].index + hits[k - 1][0].length : 0, m.index);
    const after = html.slice(m.index + m[0].length, hits[k + 1]?.index ?? html.length);
    const p = after.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i);
    out.push({
      id: u.href, link: u.href, title: plain(m[2]),
      date: dataIt(plain(before).slice(-60)),
      summary: p ? plain(p[1]).slice(0, 400) : '',
    });
  });
  return out.filter(i => i.title);
}

async function get(url) {
  const r = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36',
      'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.9, */*;q=0.8',
      'Accept-Language': 'it-IT,it;q=0.9',
    },
    redirect: 'follow',
  });
  const body = await r.text();
  return { ok: r.ok, status: r.status, type: r.headers.get('content-type') || '?', body };
}

async function fetchOne(url) {
  const r = await get(url);
  if (r.ok) {
    let items = parseFeed(r.body);
    if (!items.length && /<html/i.test(r.body)) items = parseWpHtml(r.body, url);
    if (items.length) return items;
  }
  // Feed WordPress non leggibile: prova la pagina HTML corrispondente (…/feed/ → …/)
  if (/\/feed\/?$/.test(url)) {
    const pageUrl = url.replace(/feed\/?$/, '');
    const h = await get(pageUrl);
    if (h.ok) {
      const items = parseWpHtml(h.body, pageUrl);
      if (items.length) { console.log(`feed illeggibile, uso la pagina ${pageUrl}`); return items; }
    }
  }
  const snippet = r.body.replace(/\s+/g, ' ').slice(0, 90);
  throw new Error(`${url} → HTTP ${r.status}, ${r.type}, inizio risposta: "${snippet}"`);
}

export async function fetchItems() {
  const res = await Promise.allSettled(FEED_URLS.map(fetchOne));
  res.filter(r => r.status === 'rejected').forEach(r => console.error(r.reason.message));
  const all = res.filter(r => r.status === 'fulfilled').flatMap(r => r.value);
  if (!all.length) throw new Error(res.map(r => r.reason?.message).filter(Boolean).join('; ') || 'nessun avviso trovato');
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
