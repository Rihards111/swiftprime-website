// Personal brief link: swiftprimedesign.com/b/<code>
// Counts the click on the lead (no cookies, nothing personal stored) and sends the visitor to the brief form.
import { readJSON, writeJSON } from './lib/common.mjs';

export const FORMS = {
  'labels-en': 'https://docs.google.com/forms/d/e/1FAIpQLSdSpTPsYL_ZpIvhV5sgsjQ-ioVf0UBWF64Jfr0WJ23GtgWahQ/viewform?usp=pp_url&entry.2118949516=Email',
  'labels-lv': 'https://docs.google.com/forms/d/e/1FAIpQLSeNmk53OAMufU3rZ17LLA3eDRcMpYECkeBpQ2j-I8lzam1ADA/viewform?usp=pp_url&entry.1508333865=E-pasts',
  'logo-en': 'https://docs.google.com/forms/d/e/1FAIpQLSd4FiNnpkdwyTl1WuOF9zmeLS0_O3zKqChJYuwwcJbz4I7_Gw/viewform?usp=pp_url&entry.1875573346=Email',
  'logo-lv': 'https://docs.google.com/forms/d/e/1FAIpQLSd3V8XjpTQSGbNFETmQYSmzQqjJhJ_ctJPIPiuH1dl069JJ6w/viewform?usp=pp_url&entry.537777966=E-pasts'
};

export default async (req) => {
  const code = new URL(req.url).pathname.split('/').filter(Boolean)[1] || '';
  const links = await readJSON('brief-links', {});
  const link = links[code];
  if (!link) return Response.redirect('https://swiftprimedesign.com/', 302);
  const leads = await readJSON('leads', []);
  const l = leads.find((x) => x.id === link.id);
  // Skip link-preview bots (Gmail/Outlook/Slack fetch links before a person clicks).
  const ua = (req.headers.get('user-agent') || '').toLowerCase();
  const bot = /bot|preview|crawler|spider|facebookexternalhit|slack|whatsapp|googleimageproxy|outlook|safelinks/.test(ua);
  if (!bot) {
    if (l) {
      l.briefClicks = (l.briefClicks || 0) + 1;
      l.briefClickedAt = new Date().toISOString();
      l.history = l.history || [];
      if (l.briefClicks === 1) l.history.push({ s: l.status, at: l.briefClickedAt, note: 'opened the brief link', by: 'brief link' });
      await writeJSON('leads', leads);
    }
  }
  let url = FORMS[link.form] || FORMS['labels-en'];
  // Put the lead's real email in the form's email field (or leave it empty), never the word "Email".
  url = url.replace(/(entry\.\d+=)(Email|E-pasts)$/, (m, k) => (l && l.email ? k + encodeURIComponent(l.email) : '').replace(/&$/, ''));
  if (!(l && l.email)) url = url.replace(/&entry\.\d+=$/, '');
  return Response.redirect(url, 302);
};

export const config = { path: '/b/:code' };
