// Panel data API.
// GET  /api/data             (logged in)  -> everything the panel shows
// POST /api/data             (logged in)  -> panel actions (status change, reason tag, change log …)
// POST /api/data?src=task    (x-api-key)  -> the daily cloud task / brief script sends data in
import { readJSON, writeJSON, json, isLoggedIn, hasApiKey, env, uid, today } from './lib/common.mjs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// Encrypted inbox: the daily task commits panel-inbox/inbox.enc to GitHub (the repo is public, so it is
// encrypted with PANEL_API_KEY). Each deploy bundles it; new batches are applied once.
function readInbox() {
  const roots = [process.env.LAMBDA_TASK_ROOT, process.cwd(), '/var/task'].filter(Boolean);
  for (const r of roots) {
    const f = path.join(r, 'panel-inbox', 'inbox.enc');
    if (fs.existsSync(f)) {
      const box = JSON.parse(fs.readFileSync(f, 'utf8'));
      const key = crypto.createHash('sha256').update(env('PANEL_API_KEY') || '').digest();
      const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(box.iv, 'base64'));
      d.setAuthTag(Buffer.from(box.tag, 'base64'));
      return JSON.parse(Buffer.concat([d.update(Buffer.from(box.data, 'base64')), d.final()]).toString('utf8'));
    }
  }
  return null;
}
async function applyInbox() {
  try {
    const inbox = readInbox();
    if (!inbox) return;
    const done = await readJSON('inbox-applied', []);
    const fresh = (inbox.batches || []).filter((b) => !done.includes(b.id));
    for (const b of fresh) { await applyActions(b.actions || [], 'task'); done.push(b.id); }
    if (fresh.length) await writeJSON('inbox-applied', done.slice(-500));
  } catch (e) { console.log('inbox error', e.message); }
}

const CF_ACCOUNT = 'b57aea6be2989a950e1e734a301e8a46'; // Cloudflare account id (not secret); env CF_ACCOUNT_ID also works
const HOST = 'swiftprimedesign.com';

export const STATUSES = [
  'found', 'approved', 'contacted', 'followup1', 'followup2', 'replied', 'interested', 'brief_sent', 'qualified',
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


// ---- Warmerly: campaign stats + per-lead progress (runs on the server, laptop not needed) ----
const WM = 'https://app.warmerly.com/api/v1';
const WM_PROJECT = 'a8d219bc-3780-4854-b993-eeac1258eb57';
const CAMPAIGNS = {
  '181b405d-ca2f-410f-93b3-426142e436c0': 'EN Baltic producers – labels',
  '6d27b0ae-2788-492b-8a2f-a00f36db76da': 'LV producers – labels',
  '0641365b-42c7-4a86-a3a8-4364c1c09cbc': 'Kickstarter – Route 1',
  '71ec3032-7875-4713-8102-b9f19e146130': 'Kickstarter – Route 2'
};
const STEP_DAY = { '181b405d-ca2f-410f-93b3-426142e436c0': [0, 3, 7], '6d27b0ae-2788-492b-8a2f-a00f36db76da': [0, 3, 7], '0641365b-42c7-4a86-a3a8-4364c1c09cbc': [0, 4, 8], '71ec3032-7875-4713-8102-b9f19e146130': [0, 4, 8] };

async function wm(path) {
  const r = await fetch(WM + path, { headers: { 'X-Api-Key': env('WARMERLY_API_KEY'), 'X-Project-Id': WM_PROJECT } });
  if (!r.ok) throw new Error('Warmerly ' + r.status + ' ' + path);
  return r.json();
}

async function warmerlySync() {
  if (!env('WARMERLY_API_KEY')) return { error: 'WARMERLY_API_KEY missing' };
  const out = { campaigns: {}, sent: 0, replied: 0, bounced: 0 };
  const leads = await readJSON('leads', []);
  const byEmail = Object.fromEntries(leads.filter((l) => l.email).map((l) => [l.email.toLowerCase(), l]));
  let changed = false;
  for (const [id, name] of Object.entries(CAMPAIGNS)) {
    const st = await wm('/campaigns/' + id + '/stats');
    out.campaigns[name] = { leads: st.leads, emails: st.emails, rates: st.rates };
    out.sent += st.emails?.sent || 0; out.replied += st.emails?.replied || 0; out.bounced += st.emails?.bounced || 0;
    const list = await wm('/campaigns/' + id + '/leads?limit=1000');
    for (const w of list.leads || []) {
      const key = (w.email || '').toLowerCase(); if (!key) continue;
      let l = byEmail[key];
      if (!l) { l = { id: uid(), email: w.email, company: w.companyName, firstName: w.firstName, campaign: name, status: 'approved', history: [{ s: 'approved', at: w.createdAt }], createdAt: w.createdAt }; leads.push(l); byEmail[key] = l; changed = true; }
      l.campaign = l.campaign || name;
      const rank = { found: 0, approved: 0, contacted: 1, followup1: 1, followup2: 1 }[l.status];
      let target = null;
      if (w.status === 'bounced') target = 'bad_lead';
      else if (w.status === 'replied') { if (rank != null) { target = 'replied'; l.repliedAfter = 'Day ' + ((STEP_DAY[id] || [])[Math.max(0, (w.currentStep || 1) - 1)] ?? '?') + ' email'; } }
      else if (w.status === 'completed') { if (rank != null) target = 'lost_silent'; }
      else if (rank != null && (w.sentCount || 0) > 0) target = ['contacted', 'followup1', 'followup2'][Math.min(2, (w.sentCount || 1) - 1)];
      if (target && target !== l.status) { setStatus(l, target, { by: 'warmerly' }); changed = true; }
    }
  }
  if (changed) await writeJSON('leads', leads);
  return out;
}

function setStatus(lead, status, extra = {}) {
  if (!STATUSES.includes(status)) throw new Error('bad status');
  lead.status = status;
  lead.history = lead.history || [];
  lead.history.push({ s: status, at: new Date().toISOString(), ...extra });
}

let pushResult = null;
async function applyActions(actions, who) {
  const leads = await readJSON('leads', []);
  const byId = Object.fromEntries(leads.map((l) => [l.id, l]));
  let changelog = null, settings = null, health = null, warmerly = null, ig = null; pushResult = null;
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
      case 'pushWarmerly': {                      // add approved leads to a Warmerly campaign (stays draft until you press Start)
        const camp = Object.entries(CAMPAIGNS).find(([, n]) => n === a.campaign);
        if (!camp) throw new Error('unknown campaign ' + a.campaign);
        const todo = leads.filter((x) => x.status === 'approved' && x.email && !x.wmAdded && (x.campaign || '').startsWith(a.campaign.split(' –')[0]));
        if (!todo.length) break;
        const body = { leads: todo.map((x) => ({ email: x.email, firstName: x.firstName || '', lastName: '', companyName: x.company || '', customVars: { personal_line: x.personalLine || '' } })) };
        const r = await fetch(WM + '/campaigns/' + camp[0] + '/leads', { method: 'POST', headers: { 'X-Api-Key': env('WARMERLY_API_KEY'), 'X-Project-Id': WM_PROJECT, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const txt = await r.text();
        if (!r.ok) throw new Error('Warmerly ' + r.status + ' ' + txt.slice(0, 300));
        todo.forEach((x) => { x.wmAdded = new Date().toISOString(); });
        pushResult = { added: todo.length, response: txt.slice(0, 500) };
        break;
      }
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
      return json({ ok: true, leads: n, push: pushResult });
    } catch (e) { return json({ error: String(e.message || e) }, 400); }
  }

  await applyInbox();
  const month = today().slice(0, 7);
  const prev = new Date(Date.now() - 31 * 864e5).toISOString().slice(0, 7);
  const [leads, changelog, settings, health, warmerly, ig, c1, c2, cf, cl] = await Promise.all([
    readJSON('leads', []), readJSON('changelog', []), readJSON('settings', {}), readJSON('health', {}),
    readJSON('warmerly', null), readJSON('ig', {}), readJSON('clicks-' + prev, {}), readJSON('clicks-' + month, {}),
    cached('cache-cf2', 3 * 3600e3, cloudflare), cached('cache-clarity', 3 * 3600e3, clarity)
  ]);
  const wmData = await cached('cache-warmerly', 3600e3, warmerlySync);
  const leadsNow = wmData && !wmData.error ? await readJSON('leads', leads) : leads;
  return json({ now: new Date().toISOString(), leads: leadsNow, changelog, settings, health, warmerly: wmData || warmerly, ig, clicks: { ...c1, ...c2 }, cloudflare: cf, clarity: cl, statuses: STATUSES });
};

export const config = { path: '/api/data' };
