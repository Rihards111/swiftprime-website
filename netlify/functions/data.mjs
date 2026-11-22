// Panel data API.
// GET  /api/data             (logged in)  -> everything the panel shows
// POST /api/data             (logged in)  -> panel actions (status change, reason tag, change log …)
// POST /api/data?src=task    (x-api-key)  -> the daily cloud task / brief script sends data in
import { readJSON, writeJSON, json, isLoggedIn, hasApiKey, env, uid, today } from './lib/common.mjs';

const CF_ACCOUNT = '';              // filled in when known; env CF_ACCOUNT_ID also works
const HOST = 'swiftprimedesign.com';

export const STATUSES = [
  'found', 'approved', 'contacted', 'followup1', 'followup2', 'interested', 'brief_sent', 'qualified',
  'concept_sent', 'revision', 'won', 'delivered',
  'lost_no', 'lost_silent', 'lost_brief', 'lost_ghost', 'lost_price', 'lost_concept', 'bad_lead', 'recontact', 'rejected'
];

async function cached(key, maxAgeMs, fn) {
  const c = await readJSON(key, null);
  if (c && Date.now() - c.at < maxAgeMs) return c.data;
  try {
    const data = await fn();
    await writeJSON(key, { at: Date.now(), data });
    return data;
  } catch (e) {
    return c ? { ...c.data, stale: true, error: String(e.message || e) } : { error: String(e.message || e) };
  }
}

async function cloudflare() {
  const token = env('CF_API_TOKEN');
  if (!token) return { error: 'CF_API_TOKEN missing' };
  let acc = env('CF_ACCOUNT_ID') || CF_ACCOUNT;
  if (!acc) {
    const r = await fetch('https://api.cloudflare.com/client/v4/accounts', { headers: { Authorization: 'Bearer ' + token } });
    const j = await r.json();
    acc = j.result && j.result[0] && j.result[0].id;
    if (!acc) throw new Error('Cloudflare account not readable with this token');
  }
  const since = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  const query = `query($acc:String!,$since:Date!,$until:Date!){viewer{accounts(filter:{accountTag:$acc}){
    rumPageloadEventsAdaptiveGroups(limit:5000,filter:{date_geq:$since,date_leq:$until,requestHost:"${HOST}"},orderBy:[date_ASC]){
      count sum{visits} dimensions{date requestPath refererHost}}}}}`;
  const r = await fetch('https://api.cloudflare.com/client/v4/graphql', {
    method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables: { acc, since, until: today() } })
  });
  const j = await r.json();
  if (j.errors && j.errors.length) throw new Error(j.errors[0].message);
  const rows = j.data.viewer.accounts[0].rumPageloadEventsAdaptiveGroups.map((g) => ({
    date: g.dimensions.date, path: g.dimensions.requestPath, ref: g.dimensions.refererHost, views: g.count, visits: g.sum.visits
  }));
  return { rows };
}

async function clarity() {
  const token = env('CLARITY_API_TOKEN');
  if (!token) return { error: 'CLARITY_API_TOKEN missing' };
  const r = await fetch('https://www.clarity.ms/export-data/api/v1/project-live-insights?numOfDays=3&dimension1=URL', {
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }
  });
  if (!r.ok) throw new Error('Clarity ' + r.status);
  return { metrics: await r.json() };
}

function setStatus(lead, status, extra = {}) {
  if (!STATUSES.includes(status)) throw new Error('bad status');
  lead.status = status;
  lead.history = lead.history || [];
  lead.history.push({ s: status, at: new Date().toISOString(), ...extra });
}

async function applyActions(actions, who) {
  const leads = await readJSON('leads', []);
  const byId = Object.fromEntries(leads.map((l) => [l.id, l]));
  let changelog = null, settings = null, health = null, warmerly = null, ig = null;
  for (const a of actions) {
    const l = a.id ? byId[a.id] : null;
    switch (a.type) {
      case 'upsertLead': {                       // task: add or update a lead (matched by id or email)
        const f = a.lead || {};
        let t = f.id ? byId[f.id] : leads.find((x) => f.email && x.email && x.email.toLowerCase() === f.email.toLowerCase());
        if (!t) { t = { id: f.id || uid(), createdAt: new Date().toISOString(), status: 'found', history: [{ s: 'found', at: new Date().toISOString() }] }; leads.push(t); byId[t.id] = t; }
        const { status, ...rest } = f;
        Object.assign(t, rest);
        if (status && status !== t.status) setStatus(t, status, { by: who });
        break;
      }
      case 'status': if (l) setStatus(l, a.status, { by: who, note: a.note }); if (l && a.reason) l.reason = a.reason; if (l && a.value != null) l.value = Number(a.value); break;
      case 'field': if (l) l[a.field] = a.value; break;
      case 'delete': if (l) { leads.splice(leads.indexOf(l), 1); delete byId[a.id]; } break;
      case 'change': changelog = changelog || await readJSON('changelog', []); changelog.unshift({ id: uid(), at: new Date().toISOString(), step: a.step || '', text: String(a.text || '').slice(0, 500) }); break;
      case 'settings': settings = { ...(await readJSON('settings', {})), ...(a.settings || {}) }; break;
      case 'health': health = { ...(await readJSON('health', {})), ...(a.health || {}), updatedAt: new Date().toISOString() }; break;
      case 'warmerly': warmerly = { at: new Date().toISOString(), ...(a.data || {}) }; break;
      case 'ig': ig = ig || await readJSON('ig', {}); ig[today()] = { ...(ig[today()] || {}), ...(a.counts || {}) }; break;
    }
  }
  await writeJSON('leads', leads);
  if (changelog) await writeJSON('changelog', changelog);
  if (settings) await writeJSON('settings', settings);
  if (health) await writeJSON('health', health);
  if (warmerly) await writeJSON('warmerly', warmerly);
  if (ig) await writeJSON('ig', ig);
  return leads.length;
}

export default async (req) => {
  const url = new URL(req.url);
  const task = url.searchParams.get('src') === 'task';
  if (task ? !hasApiKey(req) : !isLoggedIn(req)) return json({ error: 'unauthorized' }, 401);

  if (req.method === 'POST') {
    let body = {};
    try { body = await req.json(); } catch {}
    try {
      const n = await applyActions(Array.isArray(body.actions) ? body.actions : [], task ? 'task' : 'you');
      return json({ ok: true, leads: n });
    } catch (e) { return json({ error: String(e.message || e) }, 400); }
  }

  const month = today().slice(0, 7);
  const prev = new Date(Date.now() - 31 * 864e5).toISOString().slice(0, 7);
  const [leads, changelog, settings, health, warmerly, ig, c1, c2, cf, cl] = await Promise.all([
    readJSON('leads', []), readJSON('changelog', []), readJSON('settings', {}), readJSON('health', {}),
    readJSON('warmerly', null), readJSON('ig', {}), readJSON('clicks-' + prev, {}), readJSON('clicks-' + month, {}),
    cached('cache-cf', 3 * 3600e3, cloudflare), cached('cache-clarity', 3 * 3600e3, clarity)
  ]);
  return json({ now: new Date().toISOString(), leads, changelog, settings, health, warmerly, ig, clicks: { ...c1, ...c2 }, cloudflare: cf, clarity: cl, statuses: STATUSES });
};

export const config = { path: '/api/data' };
