(function () {
  'use strict';

  // ------------------------------------------------------------ state & utils
  const S = { projects: [], tasks: [], loaded: false, pending: 0, filter: 'open' };
  const $ = (sel, el) => (el || document).querySelector(sel);
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ESC[c]);
  const pad = (n) => String(n).padStart(2, '0');
  const localDate = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const today = () => localDate(new Date());
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now())
    .replace(/[^a-z0-9]/gi, '').slice(0, 12);
  const norm = (s) => String(s).toLowerCase().normalize('NFD').replace(/[^a-z0-9]/g, '');

  const project = (id) => S.projects.find((p) => p.id === id);
  const isOpen = (t) => t.status !== 'klaar';
  const byCreated = (a, b) => String(a.aangemaakt).localeCompare(String(b.aangemaakt));
  const doneOn = (t) => (t.afgerond ? localDate(new Date(t.afgerond)) : '');

  const ICON = {
    check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    sun: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"/></svg>',
    fire: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21c-3.9 0-6.5-2.6-6.5-6.2 0-3.3 2.3-5.4 3.7-7.6.4 1.6 1.3 2.8 2.5 3.4.2-2.6 1.3-5.3 3.4-7.1-.1 3 1.2 4.8 2.6 6.5 1.1 1.4 1.8 2.9 1.8 4.8 0 3.6-2.6 6.2-6.5 6.2z"/></svg>',
    note: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5h14v10l-4 4H5z M15 19v-4h4"/></svg>',
  };

  function relDays(dateStr) {
    if (!dateStr) return null;
    const d = new Date(dateStr + 'T00:00:00');
    const t = new Date(today() + 'T00:00:00');
    const diff = Math.round((d - t) / 864e5);
    if (diff < 0) return { label: Math.abs(diff) + ' d te laat', cls: 'late' };
    if (diff === 0) return { label: 'vandaag', cls: 'soon' };
    if (diff === 1) return { label: 'morgen', cls: 'soon' };
    if (diff <= 7) return { label: 'over ' + diff + ' d', cls: 'soon' };
    return { label: d.toLocaleDateString('nl-BE', { day: 'numeric', month: 'short' }), cls: '' };
  }

  // ------------------------------------------------------------ data sync
  async function load() {
    try {
      const data = await Api.call('getAll');
      S.projects = data.projects || [];
      S.tasks = data.tasks || [];
      S.loaded = true;
      render();
    } catch (e) { handleError(e); }
  }

  async function mutate(action, payload, apply) {
    apply();
    render();
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
    if (code === 'forbidden') { toast('Dit Google-account heeft geen toegang.'); return; }
    toast('Er ging iets mis: ' + ((e && e.message) || e));
    console.error(e);
  }

  // ------------------------------------------------------------ task actions
  function addTask(fields) {
    const t = Object.assign({
      id: uid(), titel: '', type: 'taak', projectId: '', status: 'open', vandaag: '',
      deadline: '', notitie: '', aangemaakt: new Date().toISOString(), afgerond: '',
    }, fields);
    mutate('createTask', t, () => S.tasks.push(t));
  }

  function patchTask(t, patch) {
    mutate('updateTask', Object.assign({ id: t.id }, patch), () => Object.assign(t, patch));
  }

  const taskActions = {
    done(t) {
      patchTask(t, isOpen(t)
        ? { status: 'klaar', afgerond: new Date().toISOString() }
        : { status: 'open', afgerond: '' });
    },
    today(t) { patchTask(t, { vandaag: t.vandaag === today() ? '' : today() }); },
    brand(t) { patchTask(t, { type: t.type === 'brand' ? 'taak' : 'brand' }); },
    edit(t) { openTaskDialog(t); },
  };

  // ------------------------------------------------------------ quick capture
  function matchProject(tag) {
    const n = norm(tag);
    if (!n) return null;
    const pool = S.projects.filter((p) => p.status !== 'afgerond');
    return pool.find((p) => norm(p.naam) === n) || pool.find((p) => norm(p.naam).startsWith(n)) ||
      pool.find((p) => norm(p.naam).includes(n)) || null;
  }

  function parseCapture(raw) {
    let text = raw.trim();
    const out = { type: 'taak', vandaag: '', projectId: currentProjectId() || '' };
    if (text.startsWith('!')) { out.type = 'brand'; text = text.slice(1); }
    text = text.replace(/(^|\s)\*(?=\s|$)/g, () => { out.vandaag = today(); return ' '; });
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
    el.innerHTML = chips.join('');
  }

  // ------------------------------------------------------------ rendering
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
    document.querySelectorAll('.tabs a').forEach((a) => {
      const tab = a.dataset.tab;
      a.classList.toggle('active', tab === r.name || (tab === 'projecten' && r.name === 'project'));
    });
    const p = currentProjectId() && project(currentProjectId());
    $('#capture-input').placeholder = p
      ? 'Nieuwe taak voor ' + p.naam + '…  (druk N)'
      : 'Wat moet er gebeuren?  (druk N)';
    renderPreview();

    const view = $('#view');
    if (!S.loaded) { view.innerHTML = '<p class="muted center pad">Laden…</p>'; return; }
    if (r.name === 'taken') view.innerHTML = viewTaken();
    else if (r.name === 'projecten') view.innerHTML = viewProjecten();
    else if (r.name === 'project') view.innerHTML = viewProject(r.id);
    else view.innerHTML = viewVandaag();
  }

  function taskRow(t, opts) {
    opts = opts || {};
    const p = !opts.hideProject && t.projectId && project(t.projectId);
    const due = isOpen(t) && relDays(t.deadline);
    const meta = [];
    if (p) meta.push('<a class="chip" href="#project/' + esc(p.id) + '">' + esc(p.naam) + '</a>');
    if (due) meta.push('<span class="chip ' + due.cls + '">' + esc(due.label) + '</span>');
    if (t.notitie) meta.push('<span class="chip icon-only" title="' + esc(t.notitie) + '">' + ICON.note + '</span>');
    const isToday = t.vandaag === today();
    return '<li class="task' + (t.type === 'brand' ? ' is-brand' : '') + (isOpen(t) ? '' : ' is-done') + '" data-id="' + esc(t.id) + '">' +
      '<button class="check" data-act="done" aria-label="' + (isOpen(t) ? 'Afvinken' : 'Heropenen') + '">' + ICON.check + '</button>' +
      '<div class="task-body" data-act="edit"><span class="task-title">' + esc(t.titel) + '</span>' +
      (meta.length ? '<span class="task-meta">' + meta.join('') + '</span>' : '') + '</div>' +
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

  function viewVandaag() {
    const td = today();
    const open = S.tasks.filter(isOpen);
    const brands = open.filter((t) => t.type === 'brand').sort(byCreated);
    const planned = open.filter((t) => t.type !== 'brand' && t.vandaag === td).sort(byCreated);
    const leftover = open.filter((t) => t.type !== 'brand' && t.vandaag && t.vandaag < td).sort(byCreated);
    const done = S.tasks.filter((t) => !isOpen(t) && doneOn(t) === td);

    const active = S.projects.filter((p) => p.status === 'actief');
    const nextSteps = [];
    const stuck = [];
    active.forEach((p) => {
      const pt = open.filter((t) => t.projectId === p.id).sort(byCreated);
      if (!pt.length) stuck.push(p);
      else if (!pt.some((t) => t.vandaag === td || t.type === 'brand')) nextSteps.push(pt[0]);
    });

    const dateLabel = new Date().toLocaleDateString('nl-BE', { weekday: 'long', day: 'numeric', month: 'long' });
    let html = '<div class="view-head"><h1>Vandaag</h1><p class="muted">' + esc(dateLabel) + '</p></div>';

    html += section(ICON.fire + 'Brandjes', brands, {
      cls: 'brands', empty: 'Geen brandjes. Rustig aan de slag met je projecten.',
    });
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
    html += section('Vandaag afgerond', done, { cls: 'done-section' });
    return html;
  }

  function viewTaken() {
    const filters = [
      ['open', 'Open'], ['inbox', 'Zonder project'], ['brand', 'Brandjes'], ['klaar', 'Afgerond'],
    ];
    let tasks = S.tasks.slice();
    if (S.filter === 'open') tasks = tasks.filter(isOpen);
    if (S.filter === 'inbox') tasks = tasks.filter((t) => isOpen(t) && !t.projectId);
    if (S.filter === 'brand') tasks = tasks.filter((t) => isOpen(t) && t.type === 'brand');
    if (S.filter === 'klaar') tasks = tasks.filter((t) => !isOpen(t)).sort((a, b) => String(b.afgerond).localeCompare(a.afgerond));
    else tasks.sort(byCreated);

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
      html += section('&nbsp;', tasks, { empty: 'Niets te zien hier.' });
    }
    return html;
  }

  function projectStats(p) {
    const pt = S.tasks.filter((t) => t.projectId === p.id);
    const done = pt.filter((t) => !isOpen(t)).length;
    const next = pt.filter(isOpen).sort(byCreated)[0];
    return { total: pt.length, done, open: pt.length - done, next, pct: pt.length ? Math.round((done / pt.length) * 100) : 0 };
  }

  function projectCard(p) {
    const st = projectStats(p);
    const due = p.status === 'actief' && relDays(p.deadline);
    return '<a class="card project-card" href="#project/' + esc(p.id) + '">' +
      '<div class="card-top"><h3>' + esc(p.naam) + '</h3>' +
      (due ? '<span class="chip ' + due.cls + '">' + esc(due.label) + '</span>' : '') + '</div>' +
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
      (order[a.status] - order[b.status]) || String(a.deadline || '9999').localeCompare(String(b.deadline || '9999')));
    const active = sorted.filter((p) => p.status === 'actief');
    const other = sorted.filter((p) => p.status !== 'actief');
    let html = '<div class="view-head row-between"><h1>Projecten</h1><button class="primary" data-act="new-project">Nieuw project</button></div>';
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
    const done = pt.filter((t) => !isOpen(t)).sort((a, b) => String(b.afgerond).localeCompare(a.afgerond));
    const due = relDays(p.deadline);
    let html = '<a class="back" href="#projecten">← Projecten</a>' +
      '<div class="view-head row-between"><div><h1>' + esc(p.naam) + '</h1>' +
      '<p class="muted">' + esc(p.status) + (p.deadline ? ' · deadline ' + esc(new Date(p.deadline + 'T00:00:00').toLocaleDateString('nl-BE')) + (due ? ' (' + esc(due.label) + ')' : '') : '') + '</p></div>' +
      '<button class="ghost" data-act="edit-project" data-id="' + esc(p.id) + '">Bewerken</button></div>';
    if (p.doel) html += '<p class="doel-block">' + esc(p.doel) + '</p>';
    html += '<div class="progress big"><span style="width:' + st.pct + '%"></span></div>' +
      '<p class="muted small-text">' + st.done + ' van ' + st.total + ' taken klaar</p>';
    html += section('Open taken', open, { hideProject: true, empty: 'Geen open taken. Wat is de volgende concrete stap?' });
    if (done.length) {
      html += '<details class="section"><summary>Afgerond <span class="count">' + done.length + '</span></summary><ul class="tasks">' +
        done.map((t) => taskRow(t, { hideProject: true })).join('') + '</ul></details>';
    }
    return html;
  }

  // ------------------------------------------------------------ dialogs
  function fillProjectSelect(sel, value) {
    sel.innerHTML = '<option value="">— geen —</option>' + S.projects
      .filter((p) => p.status !== 'afgerond' || p.id === value)
      .map((p) => '<option value="' + esc(p.id) + '">' + esc(p.naam) + '</option>').join('');
    sel.value = value || '';
  }

  function openTaskDialog(t) {
    const dlg = $('#task-dialog');
    const f = $('#task-form');
    f.titel.value = t.titel;
    f.type.value = t.type || 'taak';
    fillProjectSelect(f.projectId, t.projectId);
    f.deadline.value = t.deadline || '';
    f.vandaag.checked = t.vandaag === today();
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
    f.querySelector('[data-act="delete"]').hidden = !p;
    dlg.dataset.id = p ? p.id : '';
    dlg.returnValue = '';
    dlg.showModal();
  }

  function bindDialogs() {
    const tDlg = $('#task-dialog');
    tDlg.addEventListener('close', () => {
      if (tDlg.returnValue !== 'save') return;
      const t = S.tasks.find((x) => x.id === tDlg.dataset.id);
      if (!t) return;
      const f = $('#task-form');
      const keepToday = t.vandaag && t.vandaag !== today() ? t.vandaag : '';
      patchTask(t, {
        titel: f.titel.value.trim() || t.titel,
        type: f.type.value,
        projectId: f.projectId.value,
        deadline: f.deadline.value,
        vandaag: f.vandaag.checked ? today() : keepToday,
        notitie: f.notitie.value,
      });
    });
    $('#task-form [data-act="delete"]').addEventListener('click', () => {
      const t = S.tasks.find((x) => x.id === tDlg.dataset.id);
      if (!t || !confirm('Taak "' + t.titel + '" verwijderen?')) return;
      tDlg.close('cancel');
      mutate('deleteTask', { id: t.id }, () => { S.tasks = S.tasks.filter((x) => x !== t); });
    });

    const pDlg = $('#project-dialog');
    pDlg.addEventListener('close', () => {
      if (pDlg.returnValue !== 'save') return;
      const f = $('#project-form');
      const fields = { naam: f.naam.value.trim(), doel: f.doel.value.trim(), status: f.status.value, deadline: f.deadline.value };
      if (!fields.naam) return;
      const existing = project(pDlg.dataset.id);
      if (existing) {
        mutate('updateProject', Object.assign({ id: existing.id }, fields), () => Object.assign(existing, fields));
      } else {
        const p = Object.assign({ id: uid(), aangemaakt: new Date().toISOString(), bijgewerkt: new Date().toISOString() }, fields);
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

  // ------------------------------------------------------------ events
  function bindEvents() {
    window.addEventListener('hashchange', render);

    $('#view').addEventListener('click', (e) => {
      const filter = e.target.closest('[data-filter]');
      if (filter) { S.filter = filter.dataset.filter; render(); return; }
      if (e.target.closest('a')) return; // links (chips) gewoon laten werken
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const act = btn.dataset.act;
      if (act === 'new-project') return openProjectDialog(null);
      if (act === 'edit-project') return openProjectDialog(project(btn.dataset.id));
      const li = btn.closest('.task');
      const t = li && S.tasks.find((x) => x.id === li.dataset.id);
      if (t && taskActions[act]) taskActions[act](t);
    });

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
      if (e.key === '1') location.hash = 'vandaag';
      if (e.key === '2') location.hash = 'taken';
      if (e.key === '3') location.hash = 'projecten';
    });

    $('#logout').addEventListener('click', async () => {
      await Api.logout();
      if (Api.DEMO) { toast('In demomodus is er niets om uit te loggen.'); return; }
      if (window.google && google.accounts) google.accounts.id.disableAutoSelect();
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

  // ------------------------------------------------------------ login
  function loadGsi() {
    return new Promise((resolve, reject) => {
      if (window.google && google.accounts) return resolve();
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true;
      s.onload = resolve;
      s.onerror = () => reject(new Error('Google Sign-In kon niet laden'));
      document.head.appendChild(s);
    });
  }

  async function showLogin() {
    $('#app').hidden = true;
    $('#login').hidden = false;
    const errEl = $('#login-error');
    const cfg = window.ORDENER_CONFIG;
    if (!cfg.GOOGLE_CLIENT_ID) {
      errEl.textContent = 'GOOGLE_CLIENT_ID ontbreekt in config.js.';
      errEl.hidden = false;
      return;
    }
    try {
      await loadGsi();
      google.accounts.id.initialize({
        client_id: cfg.GOOGLE_CLIENT_ID,
        auto_select: true,
        callback: async (resp) => {
          errEl.hidden = true;
          try {
            await Api.login(resp.credential);
            showApp();
          } catch (e) {
            errEl.textContent = e.code === 'forbidden'
              ? 'Dit Google-account staat niet op de lijst met toegelaten accounts.'
              : 'Inloggen mislukt (' + (e.message || e) + ').';
            errEl.hidden = false;
          }
        },
      });
      google.accounts.id.renderButton($('#gsi-button'), { theme: 'outline', size: 'large', shape: 'pill', text: 'signin_with', locale: 'nl' });
      google.accounts.id.prompt();
    } catch (e) {
      errEl.textContent = e.message;
      errEl.hidden = false;
    }
  }

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

  // ------------------------------------------------------------ boot
  bindEvents();
  bindDialogs();
  if (Api.DEMO || Api.session()) showApp();
  else showLogin();
})();
