(function () {
  'use strict';

  // ============================================================ state & utils
  const S = {
    projects: [], tasks: [], dayNotes: [], loaded: false, pending: 0, filter: 'open',
    period: { key: 'week', from: '', to: '' },
  };
  const $ = (sel, el) => (el || document).querySelector(sel);
  const $$ = (sel, el) => Array.from((el || document).querySelectorAll(sel));
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ESC[c]);
  const pad = (n) => String(n).padStart(2, '0');
  const localDate = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const today = () => localDate(new Date());
  const parseDay = (s) => new Date(s + 'T00:00:00');
  const addDays = (s, n) => { const d = parseDay(s); d.setDate(d.getDate() + n); return localDate(d); };
  const nowIso = () => new Date().toISOString();
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now())
    .replace(/[^a-z0-9]/gi, '').slice(0, 12);
  const norm = (s) => String(s).toLowerCase().normalize('NFD').replace(/[^a-z0-9]/g, '');

  const project = (id) => S.projects.find((p) => p.id === id);
  const task = (id) => S.tasks.find((t) => t.id === id);
  const isOpen = (t) => t.status !== 'klaar';
  const byCreated = (a, b) => String(a.aangemaakt).localeCompare(String(b.aangemaakt));
  const byDoneDesc = (a, b) => String(b.afgerond).localeCompare(String(a.afgerond));
  const doneOn = (t) => (t.afgerond ? localDate(new Date(t.afgerond)) : '');
  const fmtDay = (s, opts) => parseDay(s).toLocaleDateString('nl-BE', opts || { weekday: 'short', day: 'numeric', month: 'short' });

  function weekStart(s) {
    const d = parseDay(s);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return localDate(d);
  }
  function weekNumber(s) {
    const d = parseDay(s);
    d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
    const jan4 = new Date(d.getFullYear(), 0, 4);
    return 1 + Math.round(((d - jan4) / 864e5 - 3 + ((jan4.getDay() + 6) % 7)) / 7);
  }

  // ---- soort werk
  const WERK = {
    hw: { label: 'Hardware Assistent', short: 'HW' },
    ip: { label: 'Improvement Projects', short: 'IP' },
  };
  const WERK_KEYS = ['hw', 'ip'];
  /** Soort werk van een taak: eigen keuze, anders die van het project. */
  const typeOf = (t) => t.werktype || (t.projectId && project(t.projectId) && project(t.projectId).werktype) || '';
  const werkChip = (k) => (WERK[k] ? '<span class="chip werk werk-' + k + '" title="' + esc(WERK[k].label) + '"><span class="swatch"></span>' + WERK[k].short + '</span>' : '');

  // ---- tijd (in minuten)
  const minutes = (t) => Math.max(0, Number(t.duur) || 0);
  function fmtDur(min) {
    min = Math.round(min);
    if (min < 60) return min + 'm';
    return Math.floor(min / 60) + 'u' + (min % 60 ? ' ' + pad(min % 60) + 'm' : '');
  }
  const fmtHours = (min) => (min / 60).toLocaleString('nl-BE', { maximumFractionDigits: 1 }) + ' u';
  /** "45m", "1u30", "1:30", "2u", "1,5u", "90" → minuten; '' → ''; ongeldig → null */
  function parseDur(str) {
    const s = String(str || '').trim().toLowerCase().replace(/\s+/g, '');
    if (!s) return '';
    let m;
    if ((m = s.match(/^(\d+(?:[.,]\d+)?)(?:u|h|uur)(?:(\d{1,2})(?:m|min)?)?$/))) return Math.round(parseFloat(m[1].replace(',', '.')) * 60) + (Number(m[2]) || 0);
    if ((m = s.match(/^(\d+):(\d{1,2})$/))) return Number(m[1]) * 60 + Number(m[2]);
    if ((m = s.match(/^(\d+)(?:m|min)?$/))) return Number(m[1]);
    if ((m = s.match(/^(\d+[.,]\d+)$/))) return Math.round(parseFloat(m[1].replace(',', '.')) * 60);
    return null;
  }

  const ICON = {
    check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    sun: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"/></svg>',
    fire: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21c-3.9 0-6.5-2.6-6.5-6.2 0-3.3 2.3-5.4 3.7-7.6.4 1.6 1.3 2.8 2.5 3.4.2-2.6 1.3-5.3 3.4-7.1-.1 3 1.2 4.8 2.6 6.5 1.1 1.4 1.8 2.9 1.8 4.8 0 3.6-2.6 6.2-6.5 6.2z"/></svg>',
    note: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5h14v10l-4 4H5z M15 19v-4h4"/></svg>',
    clock: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
  };

  function relDays(dateStr) {
    if (!dateStr) return null;
    const diff = Math.round((parseDay(dateStr) - parseDay(today())) / 864e5);
    if (diff < 0) return { label: Math.abs(diff) + ' d te laat', cls: 'late' };
    if (diff === 0) return { label: 'vandaag', cls: 'soon' };
    if (diff === 1) return { label: 'morgen', cls: 'soon' };
    if (diff <= 7) return { label: 'over ' + diff + ' d', cls: 'soon' };
    return { label: fmtDay(dateStr, { day: 'numeric', month: 'short' }), cls: '' };
  }

  // ============================================================ data sync
  async function load() {
    try {
      const data = await Api.call('getAll');
      S.projects = data.projects || [];
      S.tasks = data.tasks || [];
      S.dayNotes = data.dayNotes || [];
      S.loaded = true;
      render();
    } catch (e) { handleError(e); }
  }

  async function mutate(action, payload, apply, opts) {
    apply();
    if (!(opts && opts.noRender)) render();
    S.pending++;
    syncState();
    try {
      await Api.call(action, payload);
    } catch (e) {
      handleError(e);
      await load();
    } finally {
      S.pending--;
      syncState();
    }
  }

  function syncState() {
    const el = $('#sync');
    el.className = 'sync ' + (S.pending ? 'busy' : 'ok');
    el.textContent = S.pending ? 'Opslaan…' : 'Opgeslagen';
  }

  function handleError(e) {
    const code = e && e.code;
    if (code === 'unauthorized') { toast('Je sessie is verlopen, log opnieuw in.'); showLogin(); return; }
    if (code === 'unknown_action') { toast('De backend is verouderd: plak de nieuwe Code.gs in Apps Script en deploy een nieuwe versie.'); return; }
    toast('Er ging iets mis: ' + ((e && e.message) || e));
    console.error(e);
  }

  // ============================================================ task actions
  function addTask(fields) {
    const t = Object.assign({
      id: uid(), titel: '', type: 'taak', projectId: '', status: 'open', vandaag: '',
      deadline: '', notitie: '', aangemaakt: nowIso(), afgerond: '', werktype: '', duur: '',
    }, fields);
    mutate('createTask', t, () => S.tasks.push(t));
  }

  function patchTask(t, patch) {
    mutate('updateTask', Object.assign({ id: t.id }, patch), () => Object.assign(t, patch));
  }

  const taskActions = {
    done(t) {
      if (isOpen(t)) openDoneDialog(t);
      else patchTask(t, { status: 'open', afgerond: '' });
    },
    today(t) { patchTask(t, { vandaag: t.vandaag === today() ? '' : today() }); },
    brand(t) { patchTask(t, { type: t.type === 'brand' ? 'taak' : 'brand' }); },
    edit(t) { openTaskDialog(t); },
  };

  // ============================================================ quick capture
  function matchProject(tag) {
    const n = norm(tag);
    if (!n) return null;
    const pool = S.projects.filter((p) => p.status !== 'afgerond');
    return pool.find((p) => norm(p.naam) === n) || pool.find((p) => norm(p.naam).startsWith(n)) ||
      pool.find((p) => norm(p.naam).includes(n)) || null;
  }

  function parseCapture(raw) {
    let text = raw.trim();
    const out = { type: 'taak', vandaag: '', projectId: currentProjectId() || '', werktype: '' };
    if (text.startsWith('!')) { out.type = 'brand'; text = text.slice(1); }
    text = text.replace(/(^|\s)\*(?=\s|$)/g, () => { out.vandaag = today(); return ' '; });
    text = text.replace(/(^|\s)\/(hw|ip)(?=\s|$)/gi, (m, sp, k) => { out.werktype = k.toLowerCase(); return sp; });
    text = text.replace(/(^|\s)#([^\s#]+)/g, (m, sp, tag) => {
      const p = matchProject(tag);
      if (p) { out.projectId = p.id; return sp; }
      return m;
    });
    out.titel = text.replace(/\s+/g, ' ').trim();
    return out;
  }

  function renderPreview() {
    const raw = $('#capture-input').value;
    const el = $('#capture-preview');
    if (!raw.trim()) { el.innerHTML = ''; return; }
    const p = parseCapture(raw);
    const chips = [];
    if (p.type === 'brand') chips.push('<span class="chip brand">' + ICON.fire + 'Brandje</span>');
    if (p.vandaag) chips.push('<span class="chip today">' + ICON.sun + 'Vandaag</span>');
    if (p.projectId) chips.push('<span class="chip">' + esc(project(p.projectId).naam) + '</span>');
    const wt = p.werktype || (p.projectId && project(p.projectId).werktype);
    if (wt) chips.push('<span class="chip werk werk-' + wt + '"><span class="swatch"></span>' + esc(WERK[wt].label) + '</span>');
    el.innerHTML = chips.join('');
  }

  // ============================================================ routing & render
  function route() {
    const h = location.hash.replace(/^#/, '') || 'vandaag';
    const [name, id] = h.split('/');
    return { name, id };
  }
  function currentProjectId() {
    const r = route();
    return r.name === 'project' ? r.id : '';
  }

  function render() {
    const r = route();
    $$('.tabs a').forEach((a) => {
      const tab = a.dataset.tab;
      a.classList.toggle('active', tab === r.name || (tab === 'projecten' && r.name === 'project'));
    });
    const p = currentProjectId() && project(currentProjectId());
    $('#capture-input').placeholder = p
      ? 'Nieuwe taak voor ' + p.naam + '…  (druk N)'
      : 'Wat moet er gebeuren?  (druk N)';
    renderPreview();
    document.body.dataset.view = r.name;

    const view = $('#view');
    if (!S.loaded) { view.innerHTML = '<p class="muted center pad">Laden…</p>'; return; }
    // Niet hertekenen terwijl je in een dagnotitie typt
    if (document.activeElement && document.activeElement.closest && document.activeElement.closest('.day-note')) return;
    if (r.name === 'taken') view.innerHTML = viewTaken();
    else if (r.name === 'projecten') view.innerHTML = viewProjecten();
    else if (r.name === 'project') view.innerHTML = viewProject(r.id);
    else if (r.name === 'agenda') view.innerHTML = viewAgenda(r.id);
    else if (r.name === 'dashboard') { view.innerHTML = viewDashboard(); drawCharts(); }
    else view.innerHTML = viewVandaag();
  }

  function taskRow(t, opts) {
    opts = opts || {};
    const p = !opts.hideProject && t.projectId && project(t.projectId);
    const due = isOpen(t) && relDays(t.deadline);
    const meta = [];
    if (p) meta.push('<a class="chip" href="#project/' + esc(p.id) + '">' + esc(p.naam) + '</a>');
    if (!opts.hideWerk) meta.push(werkChip(typeOf(t)));
    if (due) meta.push('<span class="chip ' + due.cls + '">' + esc(due.label) + '</span>');
    if (!isOpen(t) && minutes(t)) meta.push('<span class="chip">' + ICON.clock + fmtDur(minutes(t)) + '</span>');
    if (t.notitie) meta.push('<span class="chip icon-only" title="' + esc(t.notitie) + '">' + ICON.note + '</span>');
    const isToday = t.vandaag === today();
    return '<li class="task' + (t.type === 'brand' ? ' is-brand' : '') + (isOpen(t) ? '' : ' is-done') + '" data-id="' + esc(t.id) + '">' +
      '<button class="check" data-act="done" aria-label="' + (isOpen(t) ? 'Afvinken' : 'Heropenen') + '">' + ICON.check + '</button>' +
      '<div class="task-body" data-act="edit"><span class="task-title">' + esc(t.titel) + '</span>' +
      (meta.join('') ? '<span class="task-meta">' + meta.join('') + '</span>' : '') + '</div>' +
      (isOpen(t)
        ? '<button class="icon-btn' + (isToday ? ' on-today' : '') + '" data-act="today" title="' + (isToday ? 'Niet meer vandaag' : 'Vandaag doen') + '" aria-pressed="' + isToday + '">' + ICON.sun + '</button>' +
          '<button class="icon-btn' + (t.type === 'brand' ? ' on-brand' : '') + '" data-act="brand" title="' + (t.type === 'brand' ? 'Geen brandje meer' : 'Markeer als brandje') + '" aria-pressed="' + (t.type === 'brand') + '">' + ICON.fire + '</button>'
        : '') +
      '</li>';
  }

  function section(title, tasks, opts) {
    opts = opts || {};
    if (!tasks.length && !opts.empty) return '';
    return '<section class="section ' + (opts.cls || '') + '">' +
      '<h2>' + title + (tasks.length ? ' <span class="count">' + tasks.length + '</span>' : '') + '</h2>' +
      (opts.sub ? '<p class="muted sub">' + opts.sub + '</p>' : '') +
      (tasks.length
        ? '<ul class="tasks">' + tasks.map((t) => taskRow(t, opts)).join('') + '</ul>'
        : '<p class="empty">' + opts.empty + '</p>') +
      '</section>';
  }

  // ============================================================ views: taken
  function viewVandaag() {
    const td = today();
    const open = S.tasks.filter(isOpen);
    const brands = open.filter((t) => t.type === 'brand').sort(byCreated);
    const planned = open.filter((t) => t.type !== 'brand' && t.vandaag === td).sort(byCreated);
    const leftover = open.filter((t) => t.type !== 'brand' && t.vandaag && t.vandaag < td).sort(byCreated);
    const done = S.tasks.filter((t) => !isOpen(t) && doneOn(t) === td).sort(byDoneDesc);

    const nextSteps = [];
    const stuck = [];
    S.projects.filter((p) => p.status === 'actief').forEach((p) => {
      const pt = open.filter((t) => t.projectId === p.id).sort(byCreated);
      if (!pt.length) stuck.push(p);
      else if (!pt.some((t) => t.vandaag === td || t.type === 'brand')) nextSteps.push(pt[0]);
    });

    const dateLabel = new Date().toLocaleDateString('nl-BE', { weekday: 'long', day: 'numeric', month: 'long' });
    let html = '<div class="view-head"><h1>Vandaag</h1><p class="muted cap">' + esc(dateLabel) + '</p></div>';

    html += section(ICON.fire + 'Brandjes', brands, { cls: 'brands', empty: 'Geen brandjes. Rustig aan de slag met je projecten.' });
    html += section(ICON.sun + 'Gepland voor vandaag', planned, {
      empty: 'Nog niets gepland. Kies hieronder een volgende stap of tik op ☀ bij een taak.',
    });
    html += section('Blijven liggen', leftover, { sub: 'Gepland op een eerdere dag en nog niet af.' });
    html += section('Volgende stap per project', nextSteps, {
      sub: 'De oudste open taak van elk actief project. Tik op ☀ om ze voor vandaag in te plannen.',
    });
    if (stuck.length) {
      html += '<section class="section"><h2>Projecten zonder volgende stap</h2>' +
        '<p class="muted sub">Leg een concrete volgende actie vast zodat ze niet stilvallen.</p><div class="stuck">' +
        stuck.map((p) => '<a class="chip warn" href="#project/' + esc(p.id) + '">' + esc(p.naam) + '</a>').join('') +
        '</div></section>';
    }
    if (done.length) {
      const mins = done.reduce((s, t) => s + minutes(t), 0);
      html += section('Vandaag afgerond' + (mins ? ' · ' + fmtDur(mins) : ''), done, { cls: 'done-section' });
    }
    return html;
  }

  function viewTaken() {
    const filters = [['open', 'Open'], ['inbox', 'Zonder project'], ['brand', 'Brandjes'], ['klaar', 'Afgerond']];
    let tasks = S.tasks.slice();
    if (S.filter === 'open') tasks = tasks.filter(isOpen);
    if (S.filter === 'inbox') tasks = tasks.filter((t) => isOpen(t) && !t.projectId);
    if (S.filter === 'brand') tasks = tasks.filter((t) => isOpen(t) && t.type === 'brand');
    if (S.filter === 'klaar') {
      const cutoff = addDays(today(), -30);
      tasks = tasks.filter((t) => !isOpen(t) && doneOn(t) >= cutoff).sort(byDoneDesc);
    } else tasks.sort(byCreated);

    let html = '<div class="view-head"><h1>Taken</h1></div><div class="pills">' +
      filters.map(([k, l]) => '<button class="pill' + (S.filter === k ? ' active' : '') + '" data-filter="' + k + '">' + l + '</button>').join('') +
      '</div>';

    if (S.filter === 'open') {
      const loose = tasks.filter((t) => !t.projectId || !project(t.projectId));
      html += section('Zonder project', loose, { hideProject: true });
      S.projects.filter((p) => p.status !== 'afgerond').forEach((p) => {
        html += section('<a href="#project/' + esc(p.id) + '">' + esc(p.naam) + '</a>', tasks.filter((t) => t.projectId === p.id), { hideProject: true });
      });
      const rest = tasks.filter((t) => t.projectId && project(t.projectId) && project(t.projectId).status === 'afgerond');
      html += section('In afgeronde projecten', rest);
      if (!tasks.length) html += '<p class="empty">Alles is af. Mooi werk!</p>';
    } else {
      html += section(S.filter === 'klaar' ? 'Laatste 30 dagen' : '&nbsp;', tasks, {
        empty: 'Niets te zien hier.',
        sub: S.filter === 'klaar' ? 'Oudere taken vind je in de <a href="#agenda">Agenda</a>.' : '',
      });
    }
    return html;
  }

  // ============================================================ views: projecten
  function projectStats(p) {
    const pt = S.tasks.filter((t) => t.projectId === p.id);
    const done = pt.filter((t) => !isOpen(t));
    const next = pt.filter(isOpen).sort(byCreated)[0];
    const mins = done.reduce((s, t) => s + minutes(t), 0);
    return { total: pt.length, done: done.length, next, mins, pct: pt.length ? Math.round((done.length / pt.length) * 100) : 0 };
  }

  function projectCard(p) {
    const st = projectStats(p);
    const due = p.status === 'actief' && relDays(p.deadline);
    return '<a class="card project-card" href="#project/' + esc(p.id) + '">' +
      '<div class="card-top"><h3>' + esc(p.naam) + '</h3>' +
      (due ? '<span class="chip ' + due.cls + '">' + esc(due.label) + '</span>' : '') + '</div>' +
      '<div class="card-tags">' + (p.werktype ? werkChip(p.werktype) : '<span class="chip warn small">soort werk?</span>') +
      (st.mins ? '<span class="chip">' + ICON.clock + fmtDur(st.mins) + '</span>' : '') + '</div>' +
      (p.doel ? '<p class="muted doel">' + esc(p.doel) + '</p>' : '') +
      '<div class="progress" role="progressbar" aria-valuenow="' + st.pct + '" aria-valuemin="0" aria-valuemax="100"><span style="width:' + st.pct + '%"></span></div>' +
      '<p class="card-foot"><span class="muted">' + st.done + '/' + st.total + ' klaar</span>' +
      (p.status === 'actief'
        ? (st.next ? '<span class="next">→ ' + esc(st.next.titel) + '</span>' : '<span class="next warn-text">Geen volgende stap</span>')
        : '<span class="badge">' + esc(p.status) + '</span>') +
      '</p></a>';
  }

  function viewProjecten() {
    const order = { actief: 0, gepauzeerd: 1, afgerond: 2 };
    const sorted = S.projects.slice().sort((a, b) =>
      ((order[a.status] || 0) - (order[b.status] || 0)) || String(a.deadline || '9999').localeCompare(String(b.deadline || '9999')));
    const active = sorted.filter((p) => p.status === 'actief');
    const other = sorted.filter((p) => p.status !== 'actief');
    const untyped = S.projects.filter((p) => !p.werktype);
    let html = '<div class="view-head row-between"><h1>Projecten</h1><button class="primary" data-act="new-project">Nieuw project</button></div>';
    if (untyped.length) {
      html += '<p class="notice">' + untyped.length + (untyped.length === 1 ? ' project heeft' : ' projecten hebben') +
        ' nog geen soort werk. Open ' + (untyped.length === 1 ? 'het' : 'ze') + ' en kies <strong>Hardware Assistent</strong> of <strong>Improvement Projects</strong>, dan tellen ' +
        (untyped.length === 1 ? 'de taken' : 'hun taken') + ' mee in je agenda en dashboard.</p>';
    }
    html += active.length
      ? '<div class="cards">' + active.map(projectCard).join('') + '</div>'
      : '<p class="empty">Nog geen actieve projecten. Maak er een aan voor je werk van lange adem.</p>';
    if (other.length) {
      html += '<details class="section"><summary>Gepauzeerd en afgerond <span class="count">' + other.length + '</span></summary>' +
        '<div class="cards">' + other.map(projectCard).join('') + '</div></details>';
    }
    return html;
  }

  function viewProject(id) {
    const p = project(id);
    if (!p) return '<p class="empty">Project niet gevonden. <a href="#projecten">Terug naar projecten</a></p>';
    const st = projectStats(p);
    const pt = S.tasks.filter((t) => t.projectId === p.id);
    const open = pt.filter(isOpen).sort(byCreated);
    const done = pt.filter((t) => !isOpen(t)).sort(byDoneDesc);
    const due = relDays(p.deadline);
    let html = '<a class="back" href="#projecten">← Projecten</a>' +
      '<div class="view-head row-between"><div><h1>' + esc(p.naam) + '</h1>' +
      '<p class="muted"><span class="cap">' + esc(p.status) + '</span>' +
      (p.deadline ? ' · deadline ' + esc(parseDay(p.deadline).toLocaleDateString('nl-BE')) + (due ? ' (' + esc(due.label) + ')' : '') : '') +
      (st.mins ? ' · ' + fmtDur(st.mins) + ' gewerkt' : '') + '</p>' +
      '<div class="card-tags">' + (p.werktype ? werkChip(p.werktype) + '<span class="muted small-text">' + esc(WERK[p.werktype].label) + '</span>' : '<button class="chip warn small" data-act="edit-project" data-id="' + esc(p.id) + '">Kies soort werk</button>') + '</div></div>' +
      '<button class="ghost" data-act="edit-project" data-id="' + esc(p.id) + '">Bewerken</button></div>';
    if (p.doel) html += '<p class="doel-block">' + esc(p.doel) + '</p>';
    html += '<div class="progress big"><span style="width:' + st.pct + '%"></span></div>' +
      '<p class="muted small-text">' + st.done + ' van ' + st.total + ' taken klaar</p>';
    html += section('Open taken', open, { hideProject: true, hideWerk: !!p.werktype, empty: 'Geen open taken. Wat is de volgende concrete stap?' });
    if (done.length) {
      html += '<details class="section"><summary>Afgerond <span class="count">' + done.length + '</span></summary><ul class="tasks">' +
        done.map((t) => taskRow(t, { hideProject: true, hideWerk: !!p.werktype && !t.werktype })).join('') + '</ul></details>';
    }
    return html;
  }

  // ============================================================ agenda
  function doneTasksBetween(from, to) {
    return S.tasks.filter((t) => !isOpen(t) && t.afgerond && doneOn(t) >= from && doneOn(t) <= to);
  }
  const dayNote = (d) => (S.dayNotes.find((n) => n.id === d) || {}).notitie || '';

  /** Minuten per soort werk voor een lijst taken. */
  function sumByType(list) {
    const out = { hw: 0, ip: 0, none: 0, total: 0, noTime: 0, noType: 0 };
    list.forEach((t) => {
      const k = typeOf(t) || 'none';
      const m = minutes(t);
      out[k] += m;
      out.total += m;
      if (!m) out.noTime++;
      if (k === 'none') out.noType++;
    });
    return out;
  }

  function splitBar(sum, cls) {
    if (!sum.total) return '';
    const seg = (k) => (sum[k] ? '<span class="seg-' + k + '" style="flex:' + sum[k] + '"></span>' : '');
    return '<div class="split ' + (cls || '') + '" aria-hidden="true">' + seg('hw') + seg('ip') + seg('none') + '</div>';
  }

  function agendaRow(t) {
    const p = t.projectId && project(t.projectId);
    return '<li class="agenda-item task" data-id="' + esc(t.id) + '"><div class="task-body" data-act="edit">' +
      '<span class="task-title">' + (t.type === 'brand' ? '<span class="brand-dot" title="Brandje">' + ICON.fire + '</span>' : '') + esc(t.titel) + '</span>' +
      (p ? '<span class="muted small-text">' + esc(p.naam) + '</span>' : '') + '</div>' +
      (minutes(t) ? '<span class="dur">' + fmtDur(minutes(t)) + '</span>' : '<button class="chip warn small" data-act="edit">+ tijd</button>') +
      '</li>';
  }

  function dayCard(d) {
    const list = doneTasksBetween(d, d).sort((a, b) => String(a.afgerond).localeCompare(b.afgerond));
    const note = dayNote(d);
    const sum = sumByType(list);
    const isToday = d === today();
    const dow = parseDay(d).getDay();
    if (!list.length && !note && !isToday && (dow === 0 || dow === 6)) return ''; // lege weekenddagen overslaan
    const groups = WERK_KEYS.concat(['none']).map((k) => {
      const items = list.filter((t) => (typeOf(t) || 'none') === k);
      if (!items.length) return '';
      const label = k === 'none' ? 'Nog niet ingedeeld' : WERK[k].label;
      return '<div class="agenda-group group-' + k + '"><h4><span class="swatch"></span>' + esc(label) +
        (sum[k] ? ' <span class="muted">· ' + fmtDur(sum[k]) + '</span>' : '') + '</h4><ul>' + items.map(agendaRow).join('') + '</ul></div>';
    }).join('');
    return '<article class="day-card' + (isToday ? ' is-today' : '') + (list.length || note ? '' : ' is-empty') + '">' +
      '<header class="day-head"><h3 class="cap">' + esc(fmtDay(d, { weekday: 'long', day: 'numeric', month: 'long' })) + (isToday ? ' <span class="chip today">vandaag</span>' : '') + '</h3>' +
      (sum.total ? '<span class="day-total">' + fmtDur(sum.total) + '</span>' : '') + '</header>' +
      splitBar(sum) +
      (groups || '<p class="muted small-text">Niets afgerond.</p>') +
      '<label class="day-note"><span class="sr-only">Notitie bij ' + esc(d) + '</span>' +
      '<textarea data-day="' + d + '" rows="' + (note ? 2 : 1) + '" placeholder="Notitie bij deze dag…">' + esc(note) + '</textarea></label>' +
      '</article>';
  }

  function viewAgenda(param) {
    const thisWeek = weekStart(today());
    const start = /^\d{4}-\d{2}-\d{2}$/.test(param || '') ? weekStart(param) : thisWeek;
    const end = addDays(start, 6);
    const isCurrent = start === thisWeek;
    const sum = sumByType(doneTasksBetween(start, end));
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = addDays(start, i);
      if (d <= today()) days.push(d);
    }
    let html = '<div class="view-head row-between"><div><h1>Agenda</h1><p class="muted">Week ' + weekNumber(start) + ' · ' +
      esc(fmtDay(start, { day: 'numeric', month: 'short' })) + ' – ' + esc(fmtDay(end, { day: 'numeric', month: 'short' })) + '</p></div>' +
      '<div class="week-nav"><a class="btn-like" href="#agenda/' + addDays(start, -7) + '" aria-label="Vorige week">‹</a>' +
      (isCurrent ? '' : '<a class="btn-like" href="#agenda">Deze week</a>') +
      (isCurrent ? '' : '<a class="btn-like" href="#agenda/' + addDays(start, 7) + '" aria-label="Volgende week">›</a>') + '</div></div>';
    html += '<div class="week-sum">' +
      '<span><strong>' + fmtDur(sum.total) + '</strong> deze week</span>' +
      WERK_KEYS.map((k) => '<span class="legend-item"><span class="swatch sw-' + k + '"></span>' + esc(WERK[k].label) + ' <strong>' + fmtDur(sum[k]) + '</strong></span>').join('') +
      (sum.none ? '<span class="legend-item"><span class="swatch sw-none"></span>Niet ingedeeld <strong>' + fmtDur(sum.none) + '</strong></span>' : '') +
      '<a class="link-btn" href="#dashboard">Naar dashboard →</a></div>';
    if (!days.length) html += '<p class="empty">Deze week is nog niet begonnen.</p>';
    html += days.map(dayCard).join('');
    return html;
  }

  const noteTimers = {};
  function saveDayNoteSoon(d, value, immediate) {
    clearTimeout(noteTimers[d]);
    const go = () => {
      if (value === dayNote(d)) return;
      mutate('saveDayNote', { id: d, notitie: value }, () => {
        S.dayNotes = S.dayNotes.filter((n) => n.id !== d);
        if (value.trim()) S.dayNotes.push({ id: d, notitie: value, bijgewerkt: nowIso() });
      }, { noRender: true });
    };
    if (immediate) go(); else noteTimers[d] = setTimeout(go, 1200);
  }

  // ============================================================ dashboard
  function periodRange() {
    const td = today();
    const P = S.period;
    const monthStart = (d) => d.slice(0, 8) + '01';
    const monthEnd = (d) => { const x = parseDay(monthStart(d)); x.setMonth(x.getMonth() + 1); x.setDate(0); return localDate(x); };
    switch (P.key) {
      case 'prevweek': { const s = addDays(weekStart(td), -7); return { from: s, to: addDays(s, 6), label: 'Vorige week (week ' + weekNumber(s) + ')' }; }
      case 'month': return { from: monthStart(td), to: monthEnd(td), label: cap(fmtDay(td, { month: 'long', year: 'numeric' })) };
      case 'prevmonth': { const s = addDays(monthStart(td), -1); return { from: monthStart(s), to: monthEnd(s), label: cap(fmtDay(s, { month: 'long', year: 'numeric' })) }; }
      case 'year': return { from: td.slice(0, 4) + '-01-01', to: monthEnd(td), label: 'Dit jaar (' + td.slice(0, 4) + ')' };
      case 'custom': {
        const from = P.from || addDays(td, -30), to = P.to || td;
        return { from: from <= to ? from : to, to: from <= to ? to : from, label: fmtDay(from, { day: 'numeric', month: 'short', year: 'numeric' }) + ' – ' + fmtDay(to, { day: 'numeric', month: 'short', year: 'numeric' }) };
      }
      default: { const s = weekStart(td); return { from: s, to: addDays(s, 6), label: 'Deze week (week ' + weekNumber(s) + ')' }; }
    }
  }
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  /** Verdeelt de periode in kolommen: per dag, per week of per maand. */
  function bucketize(from, to, list) {
    const span = Math.round((parseDay(to) - parseDay(from)) / 864e5) + 1;
    const mode = span <= 31 ? 'day' : span <= 26 * 7 ? 'week' : 'month';
    const buckets = [];
    const keyOf = (d) => (mode === 'day' ? d : mode === 'week' ? weekStart(d) : d.slice(0, 7));
    let d = mode === 'week' ? weekStart(from) : from;
    const seen = {};
    while (d <= to) {
      const k = keyOf(d);
      if (!seen[k]) {
        seen[k] = true;
        const label = mode === 'day' ? fmtDay(d, { weekday: 'short', day: 'numeric' })
          : mode === 'week' ? 'wk ' + weekNumber(d)
            : fmtDay(d.slice(0, 7) + '-01', { month: 'short' });
        const long = mode === 'day' ? cap(fmtDay(d, { weekday: 'long', day: 'numeric', month: 'long' }))
          : mode === 'week' ? 'Week ' + weekNumber(d) + ' (' + fmtDay(d, { day: 'numeric', month: 'short' }) + ' – ' + fmtDay(addDays(d, 6), { day: 'numeric', month: 'short' }) + ')'
            : cap(fmtDay(d.slice(0, 7) + '-01', { month: 'long', year: 'numeric' }));
        buckets.push({ key: k, label, long, hw: 0, ip: 0, none: 0, n: 0, weekend: mode === 'day' && [0, 6].includes(parseDay(d).getDay()) });
      }
      d = mode === 'month' ? (() => { const x = parseDay(d.slice(0, 7) + '-01'); x.setMonth(x.getMonth() + 1); return localDate(x); })() : addDays(d, mode === 'week' ? 7 : 1);
    }
    const byKey = {};
    buckets.forEach((b) => { byKey[b.key] = b; });
    list.forEach((t) => {
      const b = byKey[keyOf(doneOn(t))];
      if (!b) return;
      b[typeOf(t) || 'none'] += minutes(t);
      b.n++;
    });
    // lege weekenddagen weglaten in dagmodus
    return { mode, buckets: buckets.filter((b) => !b.weekend || b.hw + b.ip + b.none > 0) };
  }

  let chartData = null;

  function viewDashboard() {
    const R = periodRange();
    const list = doneTasksBetween(R.from, R.to);
    const sum = sumByType(list);
    const typed = sum.hw + sum.ip;
    const pct = (v) => (typed ? Math.round((v / typed) * 100) : 0);
    const { mode, buckets } = bucketize(R.from, R.to, list);
    chartData = { buckets, mode, hasNone: sum.none > 0 };

    const periods = [['week', 'Deze week'], ['prevweek', 'Vorige week'], ['month', 'Deze maand'], ['prevmonth', 'Vorige maand'], ['year', 'Dit jaar'], ['custom', 'Aangepast']];
    let html = '<div class="view-head row-between"><div><h1>Dashboard</h1><p class="muted">' + esc(R.label) + '</p></div>' +
      '<div class="dash-actions no-print"><button class="ghost small" data-act="export">Exporteer naar Excel</button><button class="ghost small" data-act="print">Print / PDF</button></div></div>';
    html += '<div class="filters no-print"><div class="pills">' +
      periods.map(([k, l]) => '<button class="pill' + (S.period.key === k ? ' active' : '') + '" data-period="' + k + '">' + l + '</button>').join('') + '</div>' +
      (S.period.key === 'custom'
        ? '<div class="custom-range"><label>Van <input type="date" data-range="from" value="' + R.from + '"></label><label>Tot <input type="date" data-range="to" value="' + R.to + '"></label></div>'
        : '') + '</div>';
    html += '<p class="print-only print-title">Ordener · Werkrapport · ' + esc(R.label) + ' (' + esc(fmtDay(R.from, { day: 'numeric', month: 'short', year: 'numeric' })) + ' – ' + esc(fmtDay(R.to, { day: 'numeric', month: 'short', year: 'numeric' })) + ')</p>';

    // --- kerncijfers
    html += '<div class="stats">' +
      '<div class="stat"><span class="stat-label">Totaal gewerkt</span><span class="stat-value">' + fmtHours(sum.total) + '</span><span class="stat-sub">' + list.length + ' taken afgerond</span></div>' +
      WERK_KEYS.map((k) => '<div class="stat stat-' + k + '"><span class="stat-label"><span class="swatch sw-' + k + '"></span>' + esc(WERK[k].label) + '</span><span class="stat-value">' + fmtHours(sum[k]) + '</span><span class="stat-sub">' + pct(sum[k]) + '% van het ingedeelde werk</span></div>').join('') +
      '</div>';

    if (!list.length) {
      html += '<p class="empty">Geen afgeronde taken in deze periode.</p>';
      return html;
    }

    // --- verdeling
    if (typed) {
      html += '<section class="section"><h2>Verdeling</h2><div class="ratio-bar">' +
        WERK_KEYS.filter((k) => sum[k]).map((k) => '<span class="seg-' + k + '" style="flex:' + sum[k] + '"><span class="seg-label">' + esc(WERK[k].short) + ' ' + pct(sum[k]) + '%</span></span>').join('') +
        '</div><p class="muted small-text">' + WERK_KEYS.map((k) => esc(WERK[k].label) + ': ' + fmtHours(sum[k]) + ' (' + pct(sum[k]) + '%)').join(' · ') + '</p></section>';
    }

    // --- tijdlijn
    html += '<section class="section"><h2>Gewerkte uren per ' + (mode === 'day' ? 'dag' : mode === 'week' ? 'week' : 'maand') + '</h2>' +
      '<div class="legend">' + WERK_KEYS.map((k) => '<span class="legend-item"><span class="swatch sw-' + k + '"></span>' + esc(WERK[k].label) + '</span>').join('') +
      (sum.none ? '<span class="legend-item"><span class="swatch sw-none"></span>Niet ingedeeld</span>' : '') + '</div>' +
      '<div class="chart" id="chart-time"></div>' +
      '<details class="table-view"><summary>Toon als tabel</summary><table class="data-table"><thead><tr><th>Periode</th>' +
      WERK_KEYS.map((k) => '<th>' + esc(WERK[k].short) + '</th>').join('') + (sum.none ? '<th>Niet ingedeeld</th>' : '') + '<th>Totaal</th></tr></thead><tbody>' +
      buckets.map((b) => '<tr><td>' + esc(b.long) + '</td>' + WERK_KEYS.map((k) => '<td>' + (b[k] ? fmtDur(b[k]) : '–') + '</td>').join('') +
        (sum.none ? '<td>' + (b.none ? fmtDur(b.none) : '–') + '</td>' : '') + '<td><strong>' + (b.hw + b.ip + b.none ? fmtDur(b.hw + b.ip + b.none) : '–') + '</strong></td></tr>').join('') +
      '</tbody></table></details></section>';

    // --- per project
    const perProject = {};
    list.forEach((t) => {
      const p = t.projectId && project(t.projectId);
      const k = typeOf(t) || 'none';
      const key = p ? p.id : 'los-' + k;
      const name = p ? p.naam : 'Losse taken' + (k !== 'none' ? ' (' + WERK[k].short + ')' : '');
      perProject[key] = perProject[key] || { name, k, mins: 0, n: 0 };
      perProject[key].mins += minutes(t);
      perProject[key].n++;
    });
    const rows = Object.values(perProject).filter((r) => r.mins > 0).sort((a, b) => b.mins - a.mins);
    if (rows.length) {
      const max = rows[0].mins;
      html += '<section class="section"><h2>Tijd per project</h2><ul class="hbars">' +
        rows.slice(0, 12).map((r) => '<li><span class="hbar-label" title="' + esc(r.name) + '">' + esc(r.name) + '</span>' +
          '<span class="hbar"><span class="fill-' + r.k + '" style="width:' + Math.max(1.5, (r.mins / max) * 100) + '%"></span></span>' +
          '<span class="hbar-value">' + fmtDur(r.mins) + '</span></li>').join('') +
        '</ul>' + (rows.length > 12 ? '<p class="muted small-text">+ ' + (rows.length - 12) + ' andere</p>' : '') + '</section>';
    }

    // --- aan te vullen
    const missing = list.filter((t) => !minutes(t) || !typeOf(t)).sort(byDoneDesc);
    if (missing.length) {
      html += '<details class="section no-print todo-fix"' + (missing.length <= 5 ? ' open' : '') + '><summary>Nog aan te vullen <span class="count">' + missing.length + '</span></summary>' +
        '<p class="muted sub">Deze taken missen een tijd of een soort werk, en tellen dus niet (volledig) mee. Tik om aan te vullen.</p><ul class="tasks">' +
        missing.map((t) => taskRow(t)).join('') + '</ul></details>';
    }

    // --- detail (voor je baas)
    html += '<details class="section detail-list"><summary>Alle taken in deze periode <span class="count">' + list.length + '</span></summary>' +
      WERK_KEYS.concat(['none']).map((k) => {
        const items = list.filter((t) => (typeOf(t) || 'none') === k).sort((a, b) => String(a.afgerond).localeCompare(b.afgerond));
        if (!items.length) return '';
        return '<h3 class="group-title"><span class="swatch sw-' + k + '"></span>' + esc(k === 'none' ? 'Niet ingedeeld' : WERK[k].label) + ' · ' + fmtHours(sum[k]) + '</h3>' +
          '<table class="data-table"><thead><tr><th>Datum</th><th>Taak</th><th>Project</th><th>Tijd</th></tr></thead><tbody>' +
          items.map((t) => '<tr><td>' + esc(fmtDay(doneOn(t), { day: 'numeric', month: 'short' })) + '</td><td>' + esc(t.titel) + '</td><td>' +
            esc(t.projectId && project(t.projectId) ? project(t.projectId).naam : '') + '</td><td>' + (minutes(t) ? fmtDur(minutes(t)) : '–') + '</td></tr>').join('') +
          '</tbody></table>';
      }).join('') + '</details>';
    return html;
  }

  // ---- gestapelde kolomgrafiek (SVG)
  function niceStep(maxH) {
    const steps = [0.5, 1, 2, 4, 5, 8, 10, 20, 25, 40, 50, 100, 200, 500];
    return steps.find((s) => maxH / s <= 4) || 1000;
  }

  function drawCharts() {
    const el = $('#chart-time');
    if (!el || !chartData) return;
    const { buckets } = chartData;
    const W = Math.max(280, el.clientWidth);
    const H = 240, padL = 40, padR = 8, padT = 12, padB = 28;
    const iw = W - padL - padR, ih = H - padT - padB;
    const maxMin = Math.max(60, ...buckets.map((b) => b.hw + b.ip + b.none));
    const step = niceStep(maxMin / 60);
    const top = Math.ceil(maxMin / 60 / step) * step * 60;
    const y = (m) => padT + ih - (m / top) * ih;
    const slot = iw / buckets.length;
    const bw = Math.max(4, Math.min(44, slot * 0.62));
    const labelEvery = Math.max(1, Math.ceil(46 / slot));
    let svg = '<svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Gewerkte uren per periode, per soort werk">';
    for (let v = 0; v <= top + 1; v += step * 60) {
      svg += '<line class="grid' + (v === 0 ? ' base' : '') + '" x1="' + padL + '" x2="' + (W - padR) + '" y1="' + y(v) + '" y2="' + y(v) + '"/>' +
        '<text class="axis" x="' + (padL - 8) + '" y="' + (y(v) + 4) + '" text-anchor="end">' + (v / 60).toLocaleString('nl-BE') + 'u</text>';
    }
    buckets.forEach((b, i) => {
      const cx = padL + slot * i + slot / 2;
      const x = cx - bw / 2;
      let cursor = y(0);
      const segs = ['hw', 'ip', 'none'].filter((k) => b[k] > 0);
      segs.forEach((k, j) => {
        const h = (b[k] / top) * ih;
        const gap = j > 0 ? 2 : 0;
        const yb = cursor - gap;
        const yt = Math.min(yb - 1, cursor - h);
        if (j === segs.length - 1) {
          const r = Math.min(4, (yb - yt) / 2, bw / 2);
          svg += '<path class="bar bar-' + k + '" d="M' + x + ',' + yb + 'V' + (yt + r) + 'Q' + x + ',' + yt + ' ' + (x + r) + ',' + yt + 'H' + (x + bw - r) + 'Q' + (x + bw) + ',' + yt + ' ' + (x + bw) + ',' + (yt + r) + 'V' + yb + 'Z"/>';
        } else {
          svg += '<rect class="bar bar-' + k + '" x="' + x + '" y="' + yt + '" width="' + bw + '" height="' + (yb - yt) + '"/>';
        }
        cursor = yt;
      });
      if (i % labelEvery === 0) {
        // labels aan de rand niet laten afsnijden
        const half = b.label.length * 3.2;
        const anchor = cx + half > W - padR ? 'end' : cx - half < padL ? 'start' : 'middle';
        const lx = anchor === 'end' ? W - padR : anchor === 'start' ? padL : cx;
        svg += '<text class="axis" x="' + lx + '" y="' + (H - 8) + '" text-anchor="' + anchor + '">' + esc(b.label) + '</text>';
      }
      svg += '<rect class="hit" data-i="' + i + '" x="' + (padL + slot * i) + '" y="' + padT + '" width="' + slot + '" height="' + ih + '"/>';
    });
    svg += '</svg>';
    el.innerHTML = svg;
  }

  function showTooltip(e) {
    const hit = e.target.closest && e.target.closest('.hit');
    const tip = $('#tooltip');
    $$('.hit.on').forEach((h) => h.classList.remove('on'));
    if (!hit || !chartData) { tip.hidden = true; return; }
    hit.classList.add('on');
    const b = chartData.buckets[Number(hit.dataset.i)];
    const total = b.hw + b.ip + b.none;
    tip.innerHTML = '<strong>' + esc(b.long) + '</strong>' +
      WERK_KEYS.map((k) => '<span class="tip-row"><span class="swatch sw-' + k + '"></span>' + esc(WERK[k].label) + '<b>' + (b[k] ? fmtDur(b[k]) : '–') + '</b></span>').join('') +
      (b.none ? '<span class="tip-row"><span class="swatch sw-none"></span>Niet ingedeeld<b>' + fmtDur(b.none) + '</b></span>' : '') +
      '<span class="tip-row tip-total">Totaal<b>' + (total ? fmtDur(total) : '–') + '</b></span>';
    tip.hidden = false;
    const r = hit.getBoundingClientRect();
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    let left = r.left + r.width / 2 - tw / 2;
    left = Math.max(8, Math.min(window.innerWidth - tw - 8, left));
    let topPx = r.top - th - 8;
    if (topPx < 8) topPx = r.top + 8;
    tip.style.left = left + 'px';
    tip.style.top = topPx + 'px';
  }

  function exportCsv() {
    const R = periodRange();
    const list = doneTasksBetween(R.from, R.to).sort((a, b) => String(a.afgerond).localeCompare(b.afgerond));
    const q = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const rows = [['Datum', 'Taak', 'Project', 'Soort werk', 'Minuten', 'Uren', 'Brandje', 'Notitie']];
    list.forEach((t) => {
      const k = typeOf(t);
      rows.push([doneOn(t), t.titel, t.projectId && project(t.projectId) ? project(t.projectId).naam : '', k ? WERK[k].label : 'Niet ingedeeld',
        minutes(t) || '', minutes(t) ? (minutes(t) / 60).toLocaleString('nl-BE', { maximumFractionDigits: 2 }) : '', t.type === 'brand' ? 'ja' : '', t.notitie || '']);
    });
    // Dagnotities als aparte blok onderaan
    const notes = S.dayNotes.filter((n) => n.id >= R.from && n.id <= R.to).sort((a, b) => a.id.localeCompare(b.id));
    if (notes.length) {
      rows.push([]);
      rows.push(['Datum', 'Dagnotitie']);
      notes.forEach((n) => rows.push([n.id, n.notitie]));
    }
    // ; als scheidingsteken + BOM: opent correct in Excel met Belgische instellingen
    const csv = '﻿' + rows.map((r) => r.map(q).join(';')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = 'ordener-rapport-' + R.from + '-tot-' + R.to + '.csv';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  // ============================================================ dialogs
  function fillProjectSelect(sel, value) {
    sel.innerHTML = '<option value="">— geen —</option>' + S.projects
      .filter((p) => p.status !== 'afgerond' || p.id === value)
      .map((p) => '<option value="' + esc(p.id) + '">' + esc(p.naam) + '</option>').join('');
    sel.value = value || '';
  }

  function fillWerkSelect(sel, t, projectId) {
    const p = projectId && project(projectId);
    const inherit = p && p.werktype ? 'Volgens project (' + WERK[p.werktype].label + ')' : '— niet ingedeeld —';
    sel.innerHTML = '<option value="">' + esc(inherit) + '</option>' +
      WERK_KEYS.map((k) => '<option value="' + k + '">' + esc(WERK[k].label) + '</option>').join('');
    sel.value = t.werktype || '';
  }

  /** Segmented control met twee knoppen (soort werk). */
  function renderSeg(container, value, allowEmpty) {
    container.innerHTML = WERK_KEYS.map((k) => '<button type="button" class="seg-btn seg-' + k + (value === k ? ' on' : '') + '" data-val="' + k + '" aria-pressed="' + (value === k) + '"><span class="swatch sw-' + k + '"></span>' + esc(WERK[k].label) + '</button>').join('');
    container.dataset.value = value || '';
    container.dataset.allowEmpty = allowEmpty ? '1' : '';
  }

  function openTaskDialog(t) {
    const dlg = $('#task-dialog');
    const f = $('#task-form');
    f.titel.value = t.titel;
    f.type.value = t.type || 'taak';
    fillProjectSelect(f.projectId, t.projectId);
    fillWerkSelect(f.werktype, t, t.projectId);
    f.duur.value = minutes(t) ? fmtDur(minutes(t)).replace(/\s/g, '') : '';
    f.deadline.value = t.deadline || '';
    f.vandaag.checked = t.vandaag === today();
    f.afgerondOp.value = doneOn(t);
    $('[data-open-only]', f).hidden = !isOpen(t);
    $('[data-done-only]', f).hidden = isOpen(t);
    f.notitie.value = t.notitie || '';
    dlg.dataset.id = t.id;
    dlg.returnValue = '';
    dlg.showModal();
  }

  function openProjectDialog(p) {
    const dlg = $('#project-dialog');
    const f = $('#project-form');
    f.naam.value = p ? p.naam : '';
    f.doel.value = p ? p.doel : '';
    f.status.value = p ? p.status : 'actief';
    f.deadline.value = p ? p.deadline : '';
    renderSeg($('[data-seg]', f), p ? p.werktype : '', true);
    f.querySelector('[data-act="delete"]').hidden = !p;
    dlg.dataset.id = p ? p.id : '';
    dlg.returnValue = '';
    dlg.showModal();
  }

  function openDoneDialog(t) {
    const dlg = $('#done-dialog');
    const f = $('#done-form');
    $('[data-title]', f).textContent = t.titel;
    f.duur.value = minutes(t) ? fmtDur(minutes(t)).replace(/\s/g, '') : '';
    const p = t.projectId && project(t.projectId);
    $('[data-via]', f).textContent = p && p.werktype && !t.werktype ? '(via project ' + p.naam + ')' : '';
    renderSeg($('[data-seg]', f), typeOf(t), true);
    syncDonePreview();
    dlg.dataset.id = t.id;
    dlg.returnValue = '';
    dlg.showModal();
    setTimeout(() => f.duur.focus(), 30);
  }

  function syncDonePreview() {
    const f = $('#done-form');
    const v = parseDur(f.duur.value);
    const el = $('[data-duur-preview]', f);
    $$('[data-quick] button', f).forEach((b) => b.classList.toggle('on', Number(b.dataset.min) === v));
    if (v === null) { el.textContent = 'Dat begrijp ik niet. Probeer bv. 45m, 1u30 of 2u.'; el.className = 'small-text error-text'; }
    else { el.textContent = v ? '= ' + fmtDur(v) : ''; el.className = 'small-text muted'; }
  }

  function bindDialogs() {
    // segmented controls (soort werk)
    document.addEventListener('click', (e) => {
      const b = e.target.closest('.seg-btn');
      if (!b) return;
      const seg = b.closest('[data-seg]');
      const cur = seg.dataset.value;
      const val = cur === b.dataset.val && seg.dataset.allowEmpty ? '' : b.dataset.val;
      renderSeg(seg, val, !!seg.dataset.allowEmpty);
    });

    // --- taak bewerken
    const tDlg = $('#task-dialog');
    const tf = $('#task-form');
    tf.projectId.addEventListener('change', () => {
      const t = task(tDlg.dataset.id);
      const keep = tf.werktype.value;
      fillWerkSelect(tf.werktype, { werktype: keep }, tf.projectId.value);
    });
    tf.addEventListener('submit', (e) => {
      if (e.submitter && e.submitter.value === 'save' && parseDur(tf.duur.value) === null) {
        e.preventDefault();
        tf.duur.setCustomValidity('Dat begrijp ik niet. Probeer bv. 45m, 1u30 of 2u.');
        tf.duur.reportValidity();
      }
    });
    tf.duur.addEventListener('input', () => tf.duur.setCustomValidity(''));
    tDlg.addEventListener('close', () => {
      if (tDlg.returnValue !== 'save') return;
      const t = task(tDlg.dataset.id);
      if (!t) return;
      const keepToday = t.vandaag && t.vandaag !== today() ? t.vandaag : '';
      const dur = parseDur(tf.duur.value);
      const patch = {
        titel: tf.titel.value.trim() || t.titel,
        type: tf.type.value,
        projectId: tf.projectId.value,
        werktype: tf.werktype.value,
        duur: dur === null ? t.duur : String(dur),
        deadline: tf.deadline.value,
        vandaag: tf.vandaag.checked ? today() : keepToday,
        notitie: tf.notitie.value,
      };
      if (!isOpen(t) && tf.afgerondOp.value && tf.afgerondOp.value !== doneOn(t)) {
        patch.afgerond = new Date(tf.afgerondOp.value + 'T12:00:00').toISOString();
      }
      patchTask(t, patch);
    });
    $('[data-act="delete"]', tf).addEventListener('click', () => {
      const t = task(tDlg.dataset.id);
      if (!t || !confirm('Taak "' + t.titel + '" verwijderen?')) return;
      tDlg.close('cancel');
      mutate('deleteTask', { id: t.id }, () => { S.tasks = S.tasks.filter((x) => x !== t); });
    });

    // --- afvinken
    const dDlg = $('#done-dialog');
    const df = $('#done-form');
    $('[data-quick]', df).addEventListener('click', (e) => {
      const b = e.target.closest('[data-min]');
      if (!b) return;
      df.duur.value = fmtDur(Number(b.dataset.min)).replace(/\s/g, '');
      syncDonePreview();
    });
    df.duur.addEventListener('input', () => { df.duur.setCustomValidity(''); syncDonePreview(); });
    df.addEventListener('submit', (e) => {
      if (e.submitter && e.submitter.value === 'save' && parseDur(df.duur.value) === null) {
        e.preventDefault();
        df.duur.setCustomValidity('Dat begrijp ik niet. Probeer bv. 45m, 1u30 of 2u.');
        df.duur.reportValidity();
      }
    });
    dDlg.addEventListener('close', () => {
      const t = task(dDlg.dataset.id);
      if (!t || !['save', 'skip'].includes(dDlg.returnValue)) return;
      const patch = { status: 'klaar', afgerond: nowIso() };
      const chosen = $('[data-seg]', df).dataset.value;
      // soort werk vastleggen op de taak zelf, zodat de historiek klopt als het project later verandert
      if (chosen) patch.werktype = chosen;
      if (dDlg.returnValue === 'save') {
        const dur = parseDur(df.duur.value);
        if (dur) patch.duur = String(dur);
      }
      patchTask(t, patch);
      toast(patch.duur ? 'Afgerond · ' + fmtDur(Number(patch.duur)) + (chosen ? ' ' + WERK[chosen].short : '') : 'Afgerond');
    });

    // --- project
    const pDlg = $('#project-dialog');
    pDlg.addEventListener('close', () => {
      if (pDlg.returnValue !== 'save') return;
      const f = $('#project-form');
      const fields = {
        naam: f.naam.value.trim(), doel: f.doel.value.trim(), status: f.status.value, deadline: f.deadline.value,
        werktype: $('[data-seg]', f).dataset.value || '',
      };
      if (!fields.naam) return;
      const existing = project(pDlg.dataset.id);
      if (existing) {
        mutate('updateProject', Object.assign({ id: existing.id }, fields), () => Object.assign(existing, fields));
      } else {
        const p = Object.assign({ id: uid(), aangemaakt: nowIso(), bijgewerkt: nowIso() }, fields);
        mutate('createProject', p, () => S.projects.push(p));
        location.hash = 'project/' + p.id;
      }
    });
    $('#project-form [data-act="delete"]').addEventListener('click', () => {
      const p = project(pDlg.dataset.id);
      if (!p || !confirm('Project "' + p.naam + '" verwijderen? De taken blijven bestaan, maar zonder project.')) return;
      pDlg.close('cancel');
      mutate('deleteProject', { id: p.id }, () => {
        S.projects = S.projects.filter((x) => x !== p);
        S.tasks.forEach((t) => { if (t.projectId === p.id) t.projectId = ''; });
      });
      location.hash = 'projecten';
    });
  }

  // ============================================================ events
  function bindEvents() {
    window.addEventListener('hashchange', () => { $('#tooltip').hidden = true; render(); });

    const view = $('#view');
    view.addEventListener('click', (e) => {
      const filter = e.target.closest('[data-filter]');
      if (filter) { S.filter = filter.dataset.filter; render(); return; }
      const period = e.target.closest('[data-period]');
      if (period) { S.period.key = period.dataset.period; render(); return; }
      if (e.target.closest('a')) return; // links (chips) gewoon laten werken
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const act = btn.dataset.act;
      if (act === 'new-project') return openProjectDialog(null);
      if (act === 'edit-project') return openProjectDialog(project(btn.dataset.id));
      if (act === 'print') return window.print();
      if (act === 'export') return exportCsv();
      const li = btn.closest('.task');
      const t = li && task(li.dataset.id);
      if (t && taskActions[act]) taskActions[act](t);
    });
    view.addEventListener('change', (e) => {
      const r = e.target.closest('[data-range]');
      if (r) { S.period[r.dataset.range] = r.value; render(); }
    });
    // dagnotities: automatisch bewaren
    view.addEventListener('input', (e) => {
      const ta = e.target.closest('textarea[data-day]');
      if (!ta) return;
      ta.rows = Math.max(1, Math.min(8, ta.value.split('\n').length + (ta.value.length > 70 ? 1 : 0)));
      saveDayNoteSoon(ta.dataset.day, ta.value);
    });
    view.addEventListener('focusout', (e) => {
      const ta = e.target.closest('textarea[data-day]');
      if (ta) saveDayNoteSoon(ta.dataset.day, ta.value, true);
    });

    // grafiek-tooltip
    view.addEventListener('pointermove', showTooltip);
    view.addEventListener('pointerdown', showTooltip);
    view.addEventListener('pointerleave', () => { $('#tooltip').hidden = true; });
    let resizeTimer;
    window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(drawCharts, 150); });
    window.addEventListener('beforeprint', () => { $$('#view details').forEach((d) => { d.dataset.wasOpen = d.open ? '1' : ''; d.open = true; }); });
    window.addEventListener('afterprint', () => { $$('#view details').forEach((d) => { d.open = !!d.dataset.wasOpen; }); });

    const input = $('#capture-input');
    input.addEventListener('input', renderPreview);
    $('#capture').addEventListener('submit', (e) => {
      e.preventDefault();
      const parsed = parseCapture(input.value);
      if (!parsed.titel) return;
      addTask(parsed);
      input.value = '';
      renderPreview();
      toast(parsed.type === 'brand' ? 'Brandje toegevoegd' : 'Taak toegevoegd');
    });

    document.addEventListener('keydown', (e) => {
      const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) || document.querySelector('dialog[open]');
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'n' || e.key === '/') { e.preventDefault(); input.focus(); }
      const tabs = { 1: 'vandaag', 2: 'taken', 3: 'projecten', 4: 'agenda', 5: 'dashboard' };
      if (tabs[e.key]) location.hash = tabs[e.key];
    });

    $('#logout').addEventListener('click', async () => {
      await Api.logout();
      if (Api.DEMO) { toast('In demomodus is er niets om uit te loggen.'); return; }
      showLogin();
    });
    $('#demo-reset').addEventListener('click', () => {
      if (!confirm('Demodata terugzetten naar het voorbeeld?')) return;
      Api.resetDemo();
      load();
    });
  }

  let toastTimer;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
  }

  // ============================================================ login
  const LOGIN_ERRORS = {
    forbidden: 'Fout wachtwoord.',
    locked: 'Te veel foute pogingen. Probeer het over 15 minuten opnieuw.',
    no_password: 'Er is nog geen wachtwoord ingesteld in het script (scripteigenschap PASSWORD).',
    network: 'Kan de server niet bereiken. Klopt API_URL in config.js?',
  };

  function showLogin() {
    $('#app').hidden = true;
    $('#login').hidden = false;
    $('#login-error').hidden = true;
    const pw = $('#login-password');
    pw.value = '';
    pw.focus();
  }

  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const pw = $('#login-password');
    const btn = $('#login-form button');
    const errEl = $('#login-error');
    errEl.hidden = true;
    btn.disabled = true;
    btn.textContent = 'Bezig…';
    try {
      await Api.login(pw.value);
      showApp();
    } catch (err) {
      errEl.textContent = LOGIN_ERRORS[err.code] || ('Inloggen mislukt (' + (err.message || err) + ').');
      errEl.hidden = false;
      pw.select();
    } finally {
      btn.disabled = false;
      btn.textContent = 'Inloggen';
    }
  });

  function showApp() {
    $('#login').hidden = true;
    $('#app').hidden = false;
    $('#demo-banner').hidden = !Api.DEMO;
    $('#logout').hidden = Api.DEMO;
    syncState();
    S.loaded = false;
    render();
    load();
  }

  // ============================================================ PWA
  function setupPwa() {
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname))) {
      navigator.serviceWorker.register('sw.js').catch((e) => console.warn('Service worker niet geregistreerd', e));
    }
    // Installeerknop (Chrome/Edge op Android, Windows, Mac). Op iPhone: Deel → Zet op beginscherm.
    let deferred = null;
    const btn = $('#install-btn');
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferred = e;
      btn.hidden = false;
    });
    btn.addEventListener('click', async () => {
      if (!deferred) return;
      deferred.prompt();
      await deferred.userChoice.catch(() => null);
      deferred = null;
      btn.hidden = true;
    });
    window.addEventListener('appinstalled', () => { btn.hidden = true; toast('Ordener is geïnstalleerd'); });

    // Een geïnstalleerde app blijft vaak lang open: haal verse data op als je ze terug opent.
    let hiddenAt = 0;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); return; }
      const away = Date.now() - hiddenAt > 60 * 1000;
      const busy = S.pending || document.querySelector('dialog[open]') ||
        (document.activeElement && /INPUT|TEXTAREA/.test(document.activeElement.tagName));
      if (away && S.loaded && !busy && !$('#app').hidden) load();
    });
  }

  // ============================================================ boot
  bindEvents();
  bindDialogs();
  setupPwa();
  if (Api.DEMO || Api.session()) showApp();
  else showLogin();
})();
