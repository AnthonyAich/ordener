// Praat met de Apps Script backend, of met een lokale mock in demomodus.
(function () {
  const cfg = window.ORDENER_CONFIG || {};
  const DEMO = !cfg.API_URL;
  const TOKEN_KEY = 'ordener.session';

  function store(key, val) {
    try {
      if (val === undefined) return JSON.parse(localStorage.getItem(key) || 'null');
      if (val === null) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify(val));
    } catch (e) { return null; }
  }

  class ApiError extends Error {
    constructor(code) { super(code); this.code = code; }
  }

  // ------------------------------------------------------------ remote
  async function remote(action, extra) {
    const session = store(TOKEN_KEY);
    // text/plain voorkomt een CORS-preflight, die Apps Script niet ondersteunt
    let res;
    try {
      res = await fetch(cfg.API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(Object.assign({ action, token: session && session.token }, extra)),
      });
    } catch (e) {
      throw new ApiError('network');
    }
    if (!res.ok) throw new ApiError('network');
    const body = await res.json();
    if (body.error) {
      if (body.error === 'unauthorized') store(TOKEN_KEY, null);
      throw new ApiError(body.error);
    }
    return body.data;
  }

  // ------------------------------------------------------------ demo
  const DB_KEY = 'ordener.demo';
  function demoDb() {
    let db = store(DB_KEY);
    if (!db) {
      const today = new Date().toISOString().slice(0, 10);
      const now = new Date().toISOString();
      const p1 = { id: 'demo-proj-1', naam: 'Datalake migratie', doel: 'Alle rapporten draaien op het nieuwe platform', status: 'actief', deadline: addDays(45), aangemaakt: now, bijgewerkt: now };
      const p2 = { id: 'demo-proj-2', naam: 'Onboarding handleiding', doel: 'Nieuwe collega’s zijn zelfstandig binnen een week', status: 'actief', deadline: '', aangemaakt: now, bijgewerkt: now };
      const t = (id, titel, extra) => Object.assign({ id, titel, type: 'taak', projectId: '', status: 'open', vandaag: '', deadline: '', notitie: '', aangemaakt: now, afgerond: '' }, extra);
      db = {
        projects: [p1, p2],
        tasks: [
          t('demo-task-1', 'Licentieserver geeft timeouts', { type: 'brand', notitie: 'Gemeld door het cleanroom-team' }),
          t('demo-task-2', 'Inventaris van bestaande rapporten', { projectId: p1.id, vandaag: today }),
          t('demo-task-3', 'Connector testen met staging', { projectId: p1.id }),
          t('demo-task-4', 'Schema-mapping afgerond', { projectId: p1.id, status: 'klaar', afgerond: now }),
          t('demo-task-5', 'Inhoudstafel opstellen', { projectId: p2.id }),
          t('demo-task-6', 'Antwoorden op mail van facility', {}),
        ],
      };
      store(DB_KEY, db);
    }
    return db;
  }
  function addDays(n) {
    const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10);
  }

  async function demo(action, payload) {
    await new Promise((r) => setTimeout(r, 120));
    const db = demoDb();
    const now = new Date().toISOString();
    const save = (out) => { store(DB_KEY, db); return out; };
    switch (action) {
      case 'getAll': return JSON.parse(JSON.stringify(db));
      case 'createProject': { const p = Object.assign({ status: 'actief', aangemaakt: now, bijgewerkt: now }, payload); db.projects.push(p); return save(p); }
      case 'updateProject': { const p = db.projects.find((x) => x.id === payload.id); Object.assign(p, payload, { bijgewerkt: now }); return save(p); }
      case 'deleteProject': db.projects = db.projects.filter((x) => x.id !== payload.id); db.tasks.forEach((t) => { if (t.projectId === payload.id) t.projectId = ''; }); return save(true);
      case 'createTask': { const t = Object.assign({ type: 'taak', status: 'open', aangemaakt: now }, payload); db.tasks.push(t); return save(t); }
      case 'updateTask': { const t = db.tasks.find((x) => x.id === payload.id); Object.assign(t, payload); return save(t); }
      case 'deleteTask': db.tasks = db.tasks.filter((x) => x.id !== payload.id); return save(true);
      default: throw new ApiError('unknown_action');
    }
  }

  // ------------------------------------------------------------ public
  window.Api = {
    DEMO,
    ApiError,
    session() { return DEMO ? { token: 'demo' } : store(TOKEN_KEY); },
    async login(password) {
      const data = await remote('login', { password });
      store(TOKEN_KEY, data);
      return data;
    },
    async logout() {
      if (!DEMO) { try { await remote('logout'); } catch (e) { /* sessie al weg */ } }
      store(TOKEN_KEY, null);
    },
    call(action, payload) {
      return DEMO ? demo(action, payload) : remote(action, { payload });
    },
    resetDemo() { store(DB_KEY, null); },
  };
})();
