// Swiftprime panel. Reads /api/data, shows where the funnel leaks and what to fix.
(function () {
  'use strict';
  var D = null;
  var $ = function (s) { return document.querySelector(s); };
  var esc = function (v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var pct = function (a, b) { return b ? Math.round((a / b) * 1000) / 10 : null; };
  var day = 864e5;
  var since = function (iso) { return iso ? Math.floor((Date.now() - new Date(iso).getTime()) / day) : 0; };

  // ---------- labels ----------
  var STATUS = {
    found: 'Found', approved: 'Approved', contacted: 'Contacted', followup1: 'Follow-up 1', followup2: 'Follow-up 2', replied: 'Replied – read & tag',
    interested: 'Interested', brief_sent: 'Brief sent', qualified: 'Brief in (qualified)', concept_sent: 'Concept sent',
    revision: 'In revision', won: 'Won – paid', delivered: 'Delivered',
    lost_no: 'Lost – no', lost_silent: 'Lost – silent', lost_brief: 'Lost at brief', lost_ghost: 'Ghosted after concept',
    lost_price: 'Lost – price', lost_concept: 'Lost – concept', bad_lead: 'Bad lead / bounced', recontact: 'Re-contact later', rejected: 'Rejected by you', dnc: 'Do not contact', on_hold: 'On hold – risky email'
  };
  var REASONS = [
    ['designer', 'Have a designer or agency', 'Targeting'], ['redesigned', 'Just redesigned', 'Targeting / timing'],
    ['happy', 'Happy with current design', 'Message'], ['timing', 'Not the right time', 'Timing'],
    ['budget', 'No budget / too expensive', 'Offer'], ['notdecider', 'Not the decision maker', 'Targeting'],
    ['trust', 'Not sure who you are / spam', 'Trust'], ['closing', 'Business closing / not selling', 'Bad lead'],
    ['design', 'Concept / style not right', 'Concept'], ['other', 'Other / no reason', '—']
  ];
  var RANK = { found: 0, approved: 0, rejected: -1, contacted: 1, followup1: 1, followup2: 1, lost_silent: 1, bad_lead: 1, recontact: 1,
    lost_no: 2, replied: 2, interested: 3, brief_sent: 3, lost_brief: 3, qualified: 4, concept_sent: 5, revision: 5, lost_ghost: 5,
    lost_price: 5, lost_concept: 5, won: 6, delivered: 6, dnc: 1, on_hold: 1 };

  // funnel steps: [key, label, test(maxRank, lead), target % of previous, fix guide]
  var STEPS = [
    { k: 'sent', label: 'Contacted', min: 1 },
    { k: 'replied', label: 'Replied', target: 4, fix: { title: 'Few replies', items: ['Run a Warmerly placement test – spam first.', 'Compare score-3 vs score-1 below: same low rate = message problem, big difference = targeting.', 'Rewrite the first line of the day 0 email. Change only that, wait 100 sends.'] } },
    { k: 'interested', label: 'Interested', target: 30, fix: { title: 'Replies are mostly “no”', items: ['Send the numbered question to every “no” and tag the reason.', 'Mostly “have a designer” = targeting. Mostly “current design works” = message: show the problem.', 'Mostly “budget” = price: check the budget answers in the briefs; if many say it, change prices overall.'] } },
    { k: 'qualified', label: 'Brief in', target: 50, fix: { title: 'Briefs not filled', items: ['Send the brief reminder after 2 days.', 'Ask lost ones: too long / unclear / not now / prefer to talk?', 'Offer “just answer 3 questions by email”.'] } },
    { k: 'concept', label: 'Concept sent', target: 90, fix: { title: 'Concepts not delivered in time', items: ['This one is your speed – block 48h after each brief.', 'Pause new outreach while 3+ concepts are waiting.'] } },
    { k: 'won', label: 'Paid', target: 30, fix: { title: 'Concepts don’t turn into money', items: ['Send the concept as a page link – see if they opened it.', 'Check their budget answer vs your price. Many say price → change prices overall.', 'Day 10 “close your file?” message – ask why.'] } }
  ];

  function maxRank(l) {
    var m = RANK[l.status] != null ? RANK[l.status] : 0;
    (l.history || []).forEach(function (h) { if (RANK[h.s] > m) m = RANK[h.s]; });
    return m;
  }
  function reached(l, k) {
    var m = maxRank(l);
    if (k === 'sent') return m >= 1;
    if (k === 'replied') return m >= 2;
    if (k === 'interested') return m >= 3;
    if (k === 'qualified') return m >= 4;
    if (k === 'concept') return m >= 5;
    if (k === 'won') return m >= 6;
  }

  // ---------- api ----------
  function api(method, body) {
    return fetch('/api/data', { method: method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
      .then(function (r) { if (r.status === 401) { showLogin(); throw new Error('login'); } return r.json(); });
  }
  function act(actions, msg) {
    return api('POST', { actions: actions }).then(function () { toast(msg || 'Saved'); return load(); });
  }
  function toast(t) { var el = $('#toast'); el.textContent = t; el.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(function () { el.hidden = true; }, 2200); }

  function showLogin() { $('#app').hidden = true; $('#login').hidden = false; }
  $('#login-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var pw = e.target.password.value;
    fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw }), credentials: 'same-origin' })
      .then(function (r) { if (r.ok) { $('#login').hidden = true; load(); } else { $('#login-msg').textContent = 'Wrong password.'; } });
  });
  $('#logout').addEventListener('click', function () { fetch('/api/login', { method: 'DELETE', credentials: 'same-origin' }).then(showLogin); });
  $('#refresh').addEventListener('click', function () { load().then(function () { toast('Updated'); }); });

  function load() {
    return api('GET').then(function (d) { D = d; $('#app').hidden = false; render(); }).catch(function () {});
  }

  // ---------- render ----------
  var selected = null;
  function render() {
    var now = new Date();
    $('#today-date').textContent = 'swiftprimedesign.com/panel · ' + now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
    var h = now.getHours(); $('#daypart').textContent = h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening';
    renderFunnel(); renderToday(); renderApprove(); renderExport(); renderBriefs(); renderPipe(); renderRuns(); renderDays(); renderWeb(); renderMoney(); renderHealth(); renderChanges();
  }

  function funnelFor(leads) {
    return STEPS.map(function (s) { return leads.filter(function (l) { return reached(l, s.k); }).length; });
  }

  function renderFunnel() {
    var leads = D.leads.filter(function (l) { return l.status !== 'rejected'; });
    var counts = funnelFor(leads);
    var firstBad = -1;
    var html = STEPS.map(function (s, i) {
      var rate = i ? pct(counts[i], counts[i - 1]) : null;
      var enough = i && counts[i - 1] >= (i === 1 ? 50 : 5);
      var bad = i && enough && rate != null && rate < s.target;
      if (bad && firstBad < 0) firstBad = i;
      var cls = 'step' + (bad && firstBad === i ? ' bad' : (i && enough && !bad ? ' ok' : '')) + (selected === i ? ' sel' : '');
      var rt = i ? (rate == null ? '–' : rate + '%') + ' · target ' + s.target + '%' + (enough ? '' : ' · too few yet') : 'emails + DMs';
      return '<button type="button" class="' + cls + '" data-step="' + i + '"><span class="mono muted">' + esc(s.label) + '</span><span class="n">' + counts[i] + '</span><span class="rate">' + rt + '</span></button>';
    }).join('');
    $('#funnel-steps').innerHTML = html;
    var show = selected != null ? selected : firstBad;
    $('#funnel-why').innerHTML = show > 0 ? why(show, leads) : '<p class="empty">No red step yet. A step turns red when it has enough data (50 contacted, then 5 at each step) and is below target. Click any step to see its details.</p>';
    $('#funnel-steps').querySelectorAll('.step').forEach(function (b) {
      b.addEventListener('click', function () { var i = +b.dataset.step; selected = (selected === i || i === 0) ? null : i; renderFunnel(); });
    });
  }

  function bars(rows) {
    if (!rows.length) return '<p class="empty">No data yet.</p>';
    var max = Math.max.apply(null, rows.map(function (r) { return r[1]; })) || 1;
    return '<div class="bars">' + rows.map(function (r) {
      return '<div class="bar"><span>' + esc(r[0]) + '</span><span class="track"><span class="fill" style="display:block;width:' + Math.round(r[1] / max * 100) + '%"></span></span><span class="mono">' + esc(r[2] || r[1]) + '</span></div>';
    }).join('') + '</div>';
  }

  function why(i, leads) {
    var s = STEPS[i], prev = STEPS[i - 1];
    var base = leads.filter(function (l) { return reached(l, prev.k); });
    function split(field, labelFn) {
      var g = {};
      base.forEach(function (l) { var k = l[field] == null || l[field] === '' ? '—' : l[field]; g[k] = g[k] || [0, 0]; g[k][1]++; if (reached(l, s.k)) g[k][0]++; });
      return Object.keys(g).map(function (k) { var p = pct(g[k][0], g[k][1]); return [labelFn ? labelFn(k) : k, p || 0, p + '% (' + g[k][0] + '/' + g[k][1] + ')']; });
    }
    var lost = base.filter(function (l) { return !reached(l, s.k) && l.reason; });
    var rc = {}; lost.forEach(function (l) { rc[l.reason] = (rc[l.reason] || 0) + 1; });
    var reasons = Object.keys(rc).map(function (k) { var r = REASONS.find(function (x) { return x[0] === k; }) || [k, k, '']; return [r[1] + ' → ' + r[2], rc[k], String(rc[k])]; });
    var extra = '';
    if (s.k === 'replied') {
      var st = {}; base.filter(function (l) { return reached(l, 'replied'); }).forEach(function (l) { var k = l.repliedAfter || 'unknown'; st[k] = (st[k] || 0) + 1; });
      extra = '<h3 style="margin-top:12px">Which email got the reply</h3>' + bars(Object.keys(st).map(function (k) { return [k, st[k], String(st[k])]; }));
    }
    return '<div><h3>Why: ' + esc(s.label) + ' (from ' + esc(prev.label) + ')</h3>' +
      '<h3 style="margin-top:8px;font-size:13px" class="muted">By lead score</h3>' + bars(split('score', function (k) { return 'Score ' + k; })) +
      '<h3 style="margin-top:12px;font-size:13px" class="muted">By campaign</h3>' + bars(split('campaign')) +
      '<h3 style="margin-top:12px;font-size:13px" class="muted">Reasons they gave</h3>' + bars(reasons) + extra + '</div>' +
      (s.fix ? '<div class="fix"><h3>Fix guide: ' + esc(s.fix.title) + '</h3><ol>' + s.fix.items.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ol><p style="margin:0">Change one thing, add it to the change log, compare after 100 sends or 2 weeks.</p></div>' : '');
  }

  function lastAt(l, st) {
    var h = (l.history || []).filter(function (x) { return x.s === st; }).pop();
    return h ? h.at : null;
  }

  function renderToday() {
    var t = [];
    D.leads.forEach(function (l) {
      var d;
      if (l.status === 'replied') t.push([0, l, 'Replied – read it in Gmail and set Interested or Lost + reason', l.repliedAfter || '']);
      if (l.status === 'interested') t.push([0, l, 'Said yes – send the brief', 'Send the “after yes” message with the brief link']);
      if (l.status === 'lost_no' && !l.reason) t.push([1, l, 'Said no – send the numbered question', 'Then tag the reason']);
      if (l.status === 'brief_sent' && (d = since(lastAt(l, 'brief_sent'))) >= 2) t.push([2, l, 'Brief reminder (' + d + ' days)', l.briefClicks ? 'Opened the brief ' + l.briefClicks + '× but no brief yet' : 'Brief link not opened yet']);
      if (l.status === 'qualified') t.push([1, l, 'Make the concepts', 'Brief in ' + since(lastAt(l, 'qualified')) + ' day(s) ago – 48h promise']);
      if (l.status === 'concept_sent') {
        d = since(lastAt(l, 'concept_sent'));
        var f = d >= 10 ? 'Day 10: “close your file?”' : d >= 5 ? 'Day 5 follow-up (change anything?)' : d >= 2 ? 'Day 2 follow-up' : null;
        if (f) t.push([2, l, f, 'Concept sent ' + d + ' days ago · ' + (l.conceptClicks ? 'opened ' + l.conceptClicks + '× (last ' + String(l.conceptClickedAt).slice(5, 10) + '), no reply' : ((l.conceptLinks || []).length ? 'concept link NOT opened' : 'no tracked concept link')) ]);
      }
      if (l.igTodo) t.push([3, l, 'Instagram: ' + l.igTodo, l.igText || '']);
    });
    t.sort(function (a, b) { return a[0] - b[0]; });
    $('#today-count').textContent = t.length + ' to do';
    $('#today-list').innerHTML = t.length ? t.map(function (x) {
      return '<div class="item' + (x[0] === 0 ? ' hot' : '') + '"><div class="grow"><div class="t">' + esc(x[1].company || x[1].email) + ' · ' + esc(x[2]) + '</div><div class="s">' + esc(x[3]) + '</div></div><button type="button" class="btn small" data-open="' + esc(x[1].id) + '">Open</button></div>';
    }).join('') : '<p class="empty">Nothing waiting. New tasks appear here as leads move.</p>';
  }

  function renderApprove() {
    var f = D.leads.filter(function (l) { return l.status === 'found'; }).sort(function (a, b) { return (b.score || 0) - (a.score || 0); });
    $('#approve-list').innerHTML = f.length ? f.map(function (l) {
      return '<div class="item"><span class="score s' + esc(l.score) + '">Score ' + esc(l.score || '?') + '</span><div class="grow"><div class="t">' + esc(l.company) + ' <span class="s">· ' + esc([l.niche, l.country, l.campaign].filter(Boolean).join(' · ')) + '</span></div>' +
        '<div class="s">' + (l.verify ? '<b>Email: ' + esc(l.verify) + '</b> · ' : '') + esc(l.scoreReasons || '') + (l.website ? ' · <a href="' + esc(l.website) + '" target="_blank" rel="noopener">site ↗</a>' : '') + (l.shop ? ' · <a href="' + esc(l.shop) + '" target="_blank" rel="noopener">products ↗</a>' : '') + (l.instagram ? ' · <a href="https://instagram.com/' + esc(String(l.instagram).replace('@', '')) + '" target="_blank" rel="noopener">IG ↗</a>' : '') + '</div>' +
        '<textarea data-line="' + esc(l.id) + '" aria-label="Personal line for ' + esc(l.company) + '">' + esc(l.personalLine || '') + '</textarea></div>' +
        '<div class="row" style="flex-direction:column"><button type="button" class="btn light small" data-approve="' + esc(l.id) + '">Approve</button><button type="button" class="btn small" data-reject="' + esc(l.id) + '">Reject</button></div></div>';
    }).join('') : '<p class="empty">No new leads waiting. The daily task adds them here with a score and a personal line.</p>';
  }

  var COLS = [['found', 'approved'], ['contacted', 'followup1', 'followup2'], ['replied', 'interested', 'brief_sent'], ['qualified'], ['concept_sent', 'revision'], ['won', 'delivered'], ['lost_no', 'lost_silent', 'lost_brief', 'lost_ghost', 'lost_price', 'lost_concept', 'bad_lead', 'dnc'], ['recontact'], ['on_hold']];
  var COLN = ['Found / approved', 'Contacted', 'Interested', 'Brief in', 'Concept', 'Won', 'Lost', 'Re-contact later', 'On hold – risky'];
  var showArchive = false;
  document.addEventListener('click', function (e) { if (e.target.id === 'toggle-archive') { showArchive = !showArchive; e.target.textContent = showArchive ? 'Hide Lost + Re-contact' : 'Show Lost + Re-contact'; renderPipe(); } });
  function renderPipe() {
    var ARCH = [6, 7];
    $('#pipe').style.gridTemplateColumns = 'repeat(' + (showArchive ? 9 : 7) + ',minmax(150px,1fr))';
    $('#pipe').innerHTML = COLS.map(function (c, i) {
      if (!showArchive && ARCH.indexOf(i) >= 0) return '';
      var ls = D.leads.filter(function (l) { return c.indexOf(l.status) >= 0; }).sort(function (a, b) { return (b.score || 0) - (a.score || 0); });
      return '<div class="col"><h3><span>' + COLN[i] + '</span><span>' + ls.length + '</span></h3>' + ls.slice(0, 12).map(function (l) {
        return '<button type="button" class="lead' + (i === 6 ? ' lost' : '') + '" data-open="' + esc(l.id) + '">' + esc(l.company || l.email) + '<small>' + esc(STATUS[l.status] || l.status) + (l.score ? ' · score ' + esc(l.score) : '') + '</small></button>';
      }).join('') + (ls.length > 12 ? '<p class="empty">+' + (ls.length - 12) + ' more</p>' : '') + '</div>';
    }).join('');
  }

  function renderWeb() {
    var cf = D.cloudflare || {}, rows = cf.rows || [];
    var visits = rows.reduce(function (a, r) { return a + (r.visits || 0); }, 0);
    var pages = {}; rows.forEach(function (r) { pages[r.path] = (pages[r.path] || 0) + r.views; });
    var refs = {}; rows.forEach(function (r) { if (r.ref) refs[r.ref] = (refs[r.ref] || 0) + r.visits; });
    var clicks = {}; Object.keys(D.clicks || {}).forEach(function (d) { if (since(d) <= 30) Object.keys(D.clicks[d]).forEach(function (k) { var e = k.split('|')[0]; clicks[e] = (clicks[e] || 0) + D.clicks[d][k]; }); });
    var briefClicks = (clicks['brief-labels'] || 0) + (clicks['brief-logo'] || 0);
    var briefsIn = D.leads.filter(function (l) { return l.source === 'Website' && reached(l, 'qualified'); }).length;
    var top = function (o, n) { return Object.keys(o).sort(function (a, b) { return o[b] - o[a]; }).slice(0, n).map(function (k) { return [k, o[k], String(o[k])]; }); };
    var c = D.clarity && D.clarity.metrics;
    $('#web').innerHTML = (cf.error ? '<p class="empty">Cloudflare: ' + esc(cf.error) + '</p>' : '') +
      '<div class="kpis"><div class="kpi"><b>' + visits + '</b><span>Visits</span></div><div class="kpi"><b>' + briefClicks + '</b><span>Brief button clicks</span></div><div class="kpi"><b>' + briefsIn + '</b><span>Briefs from website</span></div></div>' +
      '<h3 style="font-size:13px" class="muted">Pages (views)</h3>' + bars(top(pages, 6)) +
      '<h3 style="font-size:13px" class="muted">Coming from</h3>' + bars(top(refs, 5)) +
      '<h3 style="font-size:13px" class="muted">Button clicks</h3>' + bars(top(clicks, 8)) +
      (c ? '<p class="s muted">Clarity (last 3 days): ' + esc(clarityLine(c)) + '</p>' : (D.clarity && D.clarity.error ? '<p class="empty">Clarity: ' + esc(D.clarity.error) + '</p>' : ''));
  }
  function clarityLine(m) {
    try {
      var get = function (name) { var x = m.find(function (i) { return i.metricName === name; }); return x && x.information && x.information[0]; };
      var t = get('Traffic'), sd = get('ScrollDepth'), rc = get('RageClickCount');
      return [t ? (t.totalSessionCount || 0) + ' sessions' : '', sd ? 'avg scroll ' + Math.round(sd.averageScrollDepth || 0) + '%' : '', rc ? (rc.subTotal || 0) + ' rage clicks' : ''].filter(Boolean).join(' · ');
    } catch (e) { return 'data received'; }
  }

  function renderMoney() {
    var m = new Date().toISOString().slice(0, 7);
    var won = D.leads.filter(function (l) { return l.status === 'won' || l.status === 'delivered' || l.paidAt; });
    var paidMonth = won.filter(function (l) { return (l.paidAt || lastAt(l, 'won') || '').slice(0, 7) === m; }).reduce(function (a, l) { return a + (Number(l.value) || 0); }, 0);
    var open = D.leads.filter(function (l) { return ['qualified', 'concept_sent', 'revision'].indexOf(l.status) >= 0; });
    $('#money-box').innerHTML = '<div class="kpis"><div class="kpi"><b>€' + paidMonth + '</b><span>Paid this month</span></div><div class="kpi"><b>' + won.length + '</b><span>Clients all time</span></div><div class="kpi"><b>' + open.length + '</b><span>Open concepts</span></div></div>' +
      (won.length ? '<table><tr><th>Client</th><th>Status</th><th>€</th></tr>' + won.map(function (l) { return '<tr><td>' + esc(l.company) + '</td><td>' + esc(STATUS[l.status]) + '</td><td>' + esc(l.value || '') + '</td></tr>'; }).join('') + '</table>' : '<p class="empty">No paid projects yet. Mark a lead “Won – paid” and enter the € amount.</p>');
  }

  function renderHealth() {
    var h = D.health || {}, w = D.warmerly;
    $('#health').innerHTML =
      '<table><tr><th>Mailbox</th><th>Health</th></tr>' +
      ['rihards@swiftprimedesign.com', 'rihards@scribtly.com'].map(function (mb) { var v = (h.mailboxes || {})[mb]; return '<tr><td>' + mb + '</td><td>' + (v != null ? esc(v) + ' / 100' : '–') + '</td></tr>'; }).join('') + '</table>' +
      '<p class="s muted">Spam rate: ' + (h.spamRate != null ? esc(h.spamRate) + '%' : '–') + (h.updatedAt ? ' · updated ' + since(h.updatedAt) + ' day(s) ago' : '') + '</p>' +
      (w && w.campaigns ? '<table><tr><th>Campaign</th><th>Sent</th><th>Replies</th><th>Bounced</th></tr>' + Object.keys(w.campaigns).map(function (k) { var c = w.campaigns[k].emails || {}; return '<tr><td>' + esc(k) + '</td><td>' + (c.sent || 0) + '</td><td>' + (c.replied || 0) + '</td><td>' + (c.bounced || 0) + '</td></tr>'; }).join('') + '</table>' : '<p class="empty">Warmerly: ' + esc((w && w.error) || 'no data yet') + '</p>');
  }

  function renderChanges() {
    var sel = document.querySelector('#change-form select');
    if (!sel.options.length) sel.innerHTML = STEPS.slice(1).map(function (s) { return '<option>' + esc(s.label) + '</option>'; }).join('') + '<option>Targeting</option><option>Other</option>';
    $('#change-list').innerHTML = D.changelog.length ? D.changelog.slice(0, 20).map(function (c) {
      return '<div class="item"><span class="mono muted">' + esc(c.at.slice(0, 10)) + '</span><div class="grow"><div class="t">' + esc(c.text) + '</div><div class="s">' + esc(c.step) + '</div></div></div>';
    }).join('') : '<p class="empty">No changes logged yet.</p>';
  }
  $('#change-form').addEventListener('submit', function (e) {
    e.preventDefault(); var f = e.target;
    act([{ type: 'change', step: f.step.value, text: f.text.value }], 'Change logged').then(function () { f.text.value = ''; });
  });


  // ---------- export to Warmerly ----------
  function exportGroup(l) {
    var c = String(l.campaign || 'Other').replace(/\s*\(not in Warmerly yet\)\s*/i, '').trim();
    if (/^LV/i.test(c) && !l.firstName) return 'LV – bez vārda';
    return c;
  }
  function renderExport() {
    var g = {};
    D.leads.filter(function (l) { return l.status === 'approved' && l.email; }).forEach(function (l) {
      var k = exportGroup(l); g[k] = g[k] || { n: 0, all: 0 }; g[k].all++; if (!l.exportedAt) g[k].n++;
    });
    var keys = Object.keys(g).sort(function (a, b) { return g[b].n - g[a].n; });
    $('#export-list').innerHTML = keys.length ? keys.map(function (k) {
      var q = encodeURIComponent(k);
      return '<div class="item"><div class="grow"><div class="t">' + esc(k) + '</div><div class="s">' + g[k].n + ' new approved · ' + g[k].all + ' approved in total · best score first</div></div>' +
        (g[k].n ? '<a class="btn light small" href="/api/export?campaign=' + q + '" data-export>Download new (' + g[k].n + ')</a>' : '<span class="s muted">nothing new</span>') +
        '<a class="btn small" href="/api/export?campaign=' + q + '&all=1" data-export>All again</a></div>';
    }).join('') : '<p class="empty">No approved leads yet.</p>';
  }
  document.addEventListener('click', function (e) { if (e.target.closest('[data-export]')) setTimeout(load, 2500); });

  // ---------- lead runs ----------
  function renderRuns() {
    var r = D.runs || [];
    $('#runs-list').innerHTML = r.length ? '<table><tr><th>When</th><th>New</th><th>By source</th><th>Dropped</th><th>Apify</th><th>Problems</th></tr>' + r.slice(0, 20).map(function (x) {
      var src = x.sources ? Object.keys(x.sources).map(function (k) { return k + ' ' + x.sources[k]; }).join(', ') : '';
      var dr = x.dropped != null ? x.dropped + (x.droppedReasons ? ' (' + Object.keys(x.droppedReasons).map(function (k) { return k + ' ' + x.droppedReasons[k]; }).join(', ') + ')' : '') : '';
      return '<tr><td>' + esc(x.at.slice(0, 16).replace('T', ' ')) + (x.trigger ? ' · ' + esc(x.trigger) : '') + '</td><td>' + esc(x.added != null ? x.added : '') + '</td><td>' + esc(src) + '</td><td>' + esc(dr) + '</td><td>' + esc(x.apifyUsd != null ? '$' + x.apifyUsd : '') + '</td><td>' + esc((x.errors || []).join('; ')) + '</td></tr>';
    }).join('') + '</table>' : '<p class="empty">No runs logged yet. Each nightly run (04:37) and each “Start lead search now” adds a line here.</p>';
    var b = $('#start-run'); if (b) b.title = D.canStartRun ? 'Starts a lead search in the cloud (10–30 min)' : 'Opens the lead search in Claude – click Run now there';
  }
  var RUN_PAGE = 'https://claude.ai/scheduled-task/trig_018koRbeRqAwB8RWuD2jXqKG';
  $('#start-run').addEventListener('click', function () {
    if (!D.canStartRun) { window.open(RUN_PAGE, '_blank'); toast('Click “Run now” on the page that opened'); return; }
    if (!confirm('Start a lead search now? It runs in the cloud and takes 10–30 minutes. New leads appear in “Leads to approve”.')) return;
    fetch('/api/run', { method: 'POST', credentials: 'same-origin' }).then(function (r) { return r.json(); })
      .then(function (j) { toast(j.ok ? 'Lead search started – check back in 10–30 min' : (j.error || 'Could not start')); });
  });


  // ---------- briefs funnel ----------
  function renderBriefs() {
    var sent = D.leads.filter(function (l) { return (l.briefLinks || []).length; });
    var opened = sent.filter(function (l) { return l.briefClicks; });
    var filled = D.leads.filter(function (l) { return l.briefFilledAt; });
    var rows = sent.concat(filled.filter(function (l) { return sent.indexOf(l) < 0; })).sort(function (a, b) {
      return String(b.briefFilledAt || b.briefClickedAt || '').localeCompare(String(a.briefFilledAt || a.briefClickedAt || ''));
    });
    var un = D.briefsUnmatched || [];
    $('#briefs-box').innerHTML = '<div class="kpis"><div class="kpi"><b>' + sent.length + '</b><span>Links sent</span></div><div class="kpi"><b>' + opened.length + '</b><span>Opened</span></div><div class="kpi"><b>' + filled.length + '</b><span>Filled ✓</span></div></div>' +
      (rows.length ? '<div class="list">' + rows.slice(0, 30).map(function (l) {
        var st = l.briefFilledAt ? 'Filled ✓ ' + String(l.briefFilledAt).slice(0, 10) : l.briefClicks ? 'Opened ' + l.briefClicks + '× · not filled' : 'Not opened';
        return '<div class="item" data-open="' + esc(l.id) + '"><div class="grow"><div class="t">' + esc(l.company || l.email) + '</div><div class="s">' + esc(st) + '</div></div></div>';
      }).join('') + '</div>' : '<p class="empty">No brief links sent yet. Open a lead → Brief link → copy it into your reply.</p>') +
      (un.length ? '<p class="s">Briefs from emails not in the panel: ' + un.slice(0, 10).map(function (x) { return esc(x.email) + ' (' + esc(String(x.at).slice(0, 10)) + ')'; }).join(', ') + '</p>' : '');
  }

  // ---------- run days ----------
  var DAYN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  function renderDays() {
    var on = (D.settings && D.settings.runDays) || [0, 1, 2, 3, 4, 5, 6];
    $('#run-days').innerHTML = '<span class="s">Nightly search (04:37) on:</span>' + [1, 2, 3, 4, 5, 6, 0].map(function (d) {
      return '<label class="s" style="margin-left:8px"><input type="checkbox" data-day="' + d + '"' + (on.indexOf(d) >= 0 ? ' checked' : '') + '> ' + DAYN[d] + '</label>';
    }).join('') + '<button type="button" class="btn small light" id="save-days" style="margin-left:10px">Save days</button>';
  }
  document.addEventListener('click', function (e) {
    if (e.target.id === 'save-days') {
      var days = Array.prototype.map.call(document.querySelectorAll('[data-day]:checked'), function (x) { return Number(x.dataset.day); });
      api('POST', { actions: [{ type: 'settings', settings: { runDays: days } }] }).then(load).then(function () { toast(days.length ? 'Run days saved' : 'Saved – nightly search is OFF'); });
    }
  });

  // ---------- brief links ----------
  var FORMS = [['labels-en', 'Labels EN'], ['labels-lv', 'Labels LV'], ['logo-en', 'Logo EN'], ['logo-lv', 'Logo LV']];
  function briefBox(l) {
    var links = (l.briefLinks || []).slice().reverse();
    return '<div class="brief"><h3 style="font-size:13px;margin:12px 0 6px">Brief link (tracked)</h3>' +
      '<div class="row wrap">' + FORMS.map(function (f) { return '<button type="button" class="btn small" data-mklink="' + esc(l.id) + '" data-form="' + f[0] + '">' + f[1] + '</button>'; }).join('') + '</div>' +
      (links.length ? links.map(function (x) { var u = location.origin + '/b/' + x.code; return '<div class="row" style="margin-top:6px"><input readonly value="' + esc(u) + '" style="flex:1"><button type="button" class="btn small light" data-copy="' + esc(u) + '">Copy</button></div>'; }).join('') : '<p class="s muted">Make a link, copy it into your reply. Clicks show here.</p>') +
      '<p class="s">' + (l.briefFilledAt ? '<b>Brief filled ✓ ' + esc(String(l.briefFilledAt).slice(0, 16).replace('T', ' ')) + '</b> · ' : '') + (l.briefClicks ? 'Opened ' + l.briefClicks + '× · last ' + esc(String(l.briefClickedAt || '').slice(0, 16).replace('T', ' ')) : 'Not opened yet') + '</p></div>';
  }
  function conceptBox(l) {
    var links = (l.conceptLinks || []).slice().reverse();
    return '<div class="brief"><h3 style="font-size:13px;margin:12px 0 6px">Concept link (tracked)</h3>' +
      '<div class="row"><input id="concept-url" placeholder="Paste your concept link (https://…)" style="flex:1"><button type="button" class="btn small" data-mkconcept="' + esc(l.id) + '">Make link</button></div>' +
      links.map(function (x) { var u = location.origin + '/b/' + x.code; return '<div class="row" style="margin-top:6px"><input readonly value="' + esc(u) + '" style="flex:1"><button type="button" class="btn small light" data-copy="' + esc(u) + '">Copy</button></div>'; }).join('') +
      '<p class="s">' + (l.conceptClicks ? 'Concept opened ' + l.conceptClicks + '× · last ' + esc(String(l.conceptClickedAt || '').slice(0, 16).replace('T', ' ')) : (links.length ? 'Concept not opened yet' : 'Paste the concept page / Drive / Canva link, then copy the short link into your email.')) + '</p></div>';
  }
  document.addEventListener('click', function (e) {
    var k = e.target.closest('[data-mkconcept]');
    if (k) {
      var cid = k.dataset.mkconcept, url = ($('#concept-url').value || '').trim();
      if (!/^https:\/\//.test(url)) { toast('Paste a link that starts with https://'); return; }
      api('POST', { actions: [{ type: 'conceptLink', id: cid, url: url }] }).then(function () { return load(); }).then(function () { $('#lead-dialog').close(); openLead(cid); toast('Concept link made'); });
      return;
    }
    var c = e.target.closest('[data-copy]');
    if (c) { navigator.clipboard.writeText(c.dataset.copy).then(function () { toast('Link copied'); }); return; }
    var m = e.target.closest('[data-mklink]');
    if (m) {
      var id = m.dataset.mklink;
      api('POST', { actions: [{ type: 'briefLink', id: id, form: m.dataset.form }] }).then(function () { return load(); }).then(function () { $('#lead-dialog').close(); openLead(id); toast('Brief link made'); });
    }
  });

  // ---------- lead dialog ----------
  function openLead(id) {
    var l = D.leads.find(function (x) { return x.id === id; }); if (!l) return;
    var dlg = $('#lead-dialog');
    dlg.innerHTML = '<form method="dialog" id="lead-form"><h2>' + esc(l.company || l.email) + '</h2>' +
      '<p class="s muted">' + esc([l.firstName, l.email, l.country, l.niche, l.campaign].filter(Boolean).join(' · ')) + '</p>' +
      '<label>Status<select name="status">' + Object.keys(STATUS).map(function (k) { return '<option value="' + k + '"' + (k === l.status ? ' selected' : '') + '>' + STATUS[k] + '</option>'; }).join('') + '</select></label>' +
      '<label>Reason (for lost)<select name="reason"><option value="">–</option>' + REASONS.map(function (r) { return '<option value="' + r[0] + '"' + (r[0] === l.reason ? ' selected' : '') + '>' + r[1] + ' → ' + r[2] + '</option>'; }).join('') + '</select></label>' +
      '<div class="row"><label style="flex:1">Lead score<select name="score">' + ['', 1, 2, 3].map(function (s) { return '<option' + (String(s) === String(l.score || '') ? ' selected' : '') + '>' + s + '</option>'; }).join('') + '</select></label>' +
      '<label style="flex:1">Value €<input name="value" inputmode="numeric" value="' + esc(l.value || '') + '"></label></div>' +
      '<label>Notes<textarea name="notes">' + esc(l.notes || '') + '</textarea></label>' +
      briefBox(l) + conceptBox(l) + '<div class="hist">' + (l.history || []).slice().reverse().map(function (h) { return esc(h.at.slice(0, 16).replace('T', ' ')) + ' · ' + esc(STATUS[h.s] || h.s) + (h.note ? ' – ' + esc(h.note) : '') + (h.by ? ' (' + esc(h.by) + ')' : ''); }).join('<br>') + '</div>' +
      '<div class="row"><button class="btn primary" value="save">Save</button><button class="btn" value="cancel">Close</button></div></form>';
    dlg.showModal();
    dlg.querySelector('#lead-form').addEventListener('submit', function (e) {
      if (e.submitter && e.submitter.value !== 'save') return;
      var f = e.target, a = [];
      if (f.status.value !== l.status || f.reason.value !== (l.reason || '')) a.push({ type: 'status', id: l.id, status: f.status.value, reason: f.reason.value || undefined, value: f.value.value || undefined });
      if (f.reason.value !== (l.reason || '')) a.push({ type: 'field', id: l.id, field: 'reason', value: f.reason.value });
      if (String(f.score.value) !== String(l.score || '')) a.push({ type: 'field', id: l.id, field: 'score', value: f.score.value ? Number(f.score.value) : null });
      if (f.value.value !== String(l.value || '')) a.push({ type: 'field', id: l.id, field: 'value', value: f.value.value ? Number(f.value.value) : null });
      if (f.notes.value !== (l.notes || '')) a.push({ type: 'field', id: l.id, field: 'notes', value: f.notes.value });
      if (f.status.value === 'won' && !l.paidAt) a.push({ type: 'field', id: l.id, field: 'paidAt', value: new Date().toISOString() });
      if (a.length) act(a);
    });
  }

  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-open],[data-approve],[data-reject]'); if (!b) return;
    if (b.dataset.open) return openLead(b.dataset.open);
    var id = b.dataset.approve || b.dataset.reject;
    var line = document.querySelector('[data-line="' + id + '"]');
    var a = [];
    if (line) a.push({ type: 'field', id: id, field: 'personalLine', value: line.value });
    a.push({ type: 'status', id: id, status: b.dataset.approve ? 'approved' : 'rejected' });
    act(a, b.dataset.approve ? 'Approved' : 'Rejected');
  });

  $('#add-lead').addEventListener('click', function () {
    var company = prompt('Company name'); if (!company) return;
    var email = prompt('Email (optional)') || '';
    act([{ type: 'upsertLead', lead: { company: company, email: email, source: 'Manual', status: 'approved' } }], 'Lead added');
  });

  load();
})();
