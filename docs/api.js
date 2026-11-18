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
  const DB_KEY = 'ordener.demo.v3';
  function demoDb() {
    let db = store(DB_KEY);
    if (!db) {
      const now = new Date();
      const at = (daysAgo, hour) => { const d = new Date(now); d.setDate(d.getDate() - daysAgo); d.setHours(hour || 15, 0, 0, 0); return d.toISOString(); };
      const p1 = { id: 'demo-proj-1', naam: 'Datalake migratie', doel: 'Alle rapporten draaien op het nieuwe platform', status: 'actief', deadline: addDays(45), aangemaakt: at(40), bijgewerkt: at(1), werktype: 'ip' };
      const p2 = { id: 'demo-proj-2', naam: 'Onboarding handleiding', doel: 'Nieuwe collega’s zijn zelfstandig binnen een week', status: 'actief', deadline: '', aangemaakt: at(30), bijgewerkt: at(3), werktype: 'ip' };
      const p3 = { id: 'demo-proj-3', naam: 'Labo-opstellingen ondersteunen', doel: 'Onderzoekers kunnen zonder wachten meten', status: 'actief', deadline: '', aangemaakt: at(60), bijgewerkt: at(2), werktype: 'hw' };
      const t = (id, titel, extra) => Object.assign({ id, titel, type: 'taak', projectId: '', status: 'open', vandaag: '', deadline: '', notitie: '', aangemaakt: at(1, 9), afgerond: '', werktype: '', duur: '' }, extra);
      const tasks = [
        t('demo-task-1', 'Licentieserver geeft timeouts', { type: 'brand', notitie: 'Gemeld door het cleanroom-team', aangemaakt: at(0, 9) }),
        t('demo-task-2', 'Inventaris van bestaande rapporten', { projectId: p1.id, vandaag: addDays(0) }),
        t('demo-task-3', 'Connector testen met staging', { projectId: p1.id }),
        t('demo-task-5', 'Inhoudstafel opstellen', { projectId: p2.id }),
        t('demo-task-6', 'Antwoorden op mail van facility', {}),
      ];
      // afgeronde taken van de voorbije 5 weken (voor agenda en dashboard)
      const hwJobs = ['Oscilloscoop gekalibreerd', 'Labo-pc opnieuw geïnstalleerd', 'Netwerkkabels cleanroom vervangen', 'Printer 3e verdiep hersteld', 'Meetopstelling klaargezet', 'Laptop nieuwe collega voorbereid', 'Voeding defect: vervangen'];
      const ipJobs = ['Schema-mapping uitgewerkt', 'Dashboard-prototype gebouwd', 'Overleg met data-team', 'Handleiding hoofdstuk 2', 'Script voor rapport-export', 'Testplan geschreven'];
      let n = 100;
      for (let d = 1; d <= 35; d++) {
        const day = new Date(now); day.setDate(day.getDate() - d);
        if ([0, 6].includes(day.getDay())) continue;
        const k = (d * 7) % 5;
        const hwCount = 1 + (k % 3), ipCount = 1 + ((k + 1) % 2);
        for (let i = 0; i < hwCount; i++) {
          tasks.push(t('demo-done-' + n++, hwJobs[(d + i) % hwJobs.length], {
            status: 'klaar', afgerond: at(d, 9 + i * 2), aangemaakt: at(d + 1), type: i === 0 && d % 3 === 0 ? 'brand' : 'taak',
            projectId: i === 1 ? p3.id : '', werktype: i === 1 ? '' : 'hw', duur: String([30, 45, 60, 90, 120][(d + i) % 5]),
          }));
        }
        for (let i = 0; i < ipCount; i++) {
          tasks.push(t('demo-done-' + n++, ipJobs[(d + i) % ipJobs.length], {
            status: 'klaar', afgerond: at(d, 13 + i * 2), aangemaakt: at(d + 2), projectId: i === 0 ? p1.id : p2.id,
            duur: d === 2 && i === 0 ? '' : String([60, 90, 120, 180, 240][(d * 3 + i) % 5]),
          }));
        }
      }
      tasks.push(t('demo-done-old', 'Oude taak zonder soort', { status: 'klaar', afgerond: at(3, 11) }));
      db = {
        projects: [p1, p2, p3],
        tasks,
        dayNotes: [{ id: addDays(-1), notitie: 'Halve namiddag kwijt door netwerkpanne in gebouw 3.', aangemaakt: at(1), bijgewerkt: at(1) }],
      };
      store(DB_KEY, db);
    }
    db.dayNotes = db.dayNotes || [];
    return db;
  }
  function addDays(n) {
    const d = new Date(); d.setDate(d.getDate() + n);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
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
      case 'saveDayNote': {
        db.dayNotes = db.dayNotes.filter((x) => x.id !== payload.id);
        if (String(payload.notitie || '').trim()) db.dayNotes.push({ id: payload.id, notitie: payload.notitie, aangemaakt: now, bijgewerkt: now });
        return save(true);
      }
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
