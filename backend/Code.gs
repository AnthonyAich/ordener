/**
 * Ordener – Apps Script backend
 *
 * Koppel dit script aan een Google Sheet (Extensies > Apps Script) en
 * deploy het als Web app (Uitvoeren als: ik, Toegang: iedereen).
 * De toegang wordt afgeschermd via Google Sign-In + een e-mail-allowlist.
 *
 * Script Properties (Projectinstellingen > Scripteigenschappen):
 *   CLIENT_ID       – OAuth Client ID uit Google Cloud (Web application)
 *   ALLOWED_EMAILS  – komma-gescheiden lijst, bv. "jij@gmail.com"
 */

const SHEETS = {
  Projecten: ['id', 'naam', 'doel', 'status', 'deadline', 'aangemaakt', 'bijgewerkt'],
  Taken: ['id', 'titel', 'type', 'projectId', 'status', 'vandaag', 'deadline', 'notitie', 'aangemaakt', 'afgerond'],
};

const EDITABLE = {
  Projecten: ['naam', 'doel', 'status', 'deadline'],
  Taken: ['titel', 'type', 'projectId', 'status', 'vandaag', 'deadline', 'notitie', 'afgerond'],
};

const SESSION_DAYS = 30;
const DONE_VISIBLE_DAYS = 30; // afgeronde taken ouder dan dit worden niet meer geladen

// ---------------------------------------------------------------- setup

/** Eén keer manueel uitvoeren vanuit de editor. */
function setup() {
  const ss = SpreadsheetApp.getActive();
  Object.keys(SHEETS).forEach(function (name) {
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    const headers = SHEETS[name];
    sh.getRange(1, 1, sh.getMaxRows(), headers.length).setNumberFormat('@');
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sh.setFrozenRows(1);
  });
  const def = ss.getSheetByName('Sheet1') || ss.getSheetByName('Blad1');
  if (def && def.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(def);

  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('ALLOWED_EMAILS')) props.setProperty('ALLOWED_EMAILS', Session.getEffectiveUser().getEmail());
  if (!props.getProperty('CLIENT_ID')) props.setProperty('CLIENT_ID', 'VUL-MIJ-IN.apps.googleusercontent.com');
  Logger.log('Klaar. Vul CLIENT_ID in bij de Scripteigenschappen en deploy als Web app.');
}

// ---------------------------------------------------------------- http

function doGet() {
  return json_({ ok: true, app: 'Ordener' });
}

function doPost(e) {
  let req;
  try {
    req = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ error: 'bad_request' });
  }
  try {
    if (req.action === 'login') return json_({ ok: true, data: login_(req.idToken) });

    const user = auth_(req.token);
    if (!user) return json_({ error: 'unauthorized' });
    if (req.action === 'logout') return json_({ ok: true, data: logout_(req.token) });

    const fn = ACTIONS[req.action];
    if (!fn) return json_({ error: 'unknown_action' });

    const lock = LockService.getScriptLock();
    lock.waitLock(15000);
    try {
      return json_({ ok: true, data: fn(req.payload || {}, user) });
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return json_({ error: String((err && err.message) || err) });
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ---------------------------------------------------------------- auth

function login_(idToken) {
  if (!idToken) throw new Error('unauthorized');
  const props = PropertiesService.getScriptProperties();
  const clientId = props.getProperty('CLIENT_ID');
  const allowed = (props.getProperty('ALLOWED_EMAILS') || '')
    .split(',').map(function (s) { return s.trim().toLowerCase(); }).filter(String);

  const res = UrlFetchApp.fetch(
    'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken),
    { muteHttpExceptions: true }
  );
  if (res.getResponseCode() !== 200) throw new Error('unauthorized');
  const info = JSON.parse(res.getContentText());
  const email = String(info.email || '').toLowerCase();
  const issOk = info.iss === 'accounts.google.com' || info.iss === 'https://accounts.google.com';

  if (info.aud !== clientId || !issOk || String(info.email_verified) !== 'true' ||
      Number(info.exp) * 1000 < Date.now() || allowed.indexOf(email) === -1) {
    throw new Error('forbidden');
  }

  cleanupSessions_();
  const token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  const exp = Date.now() + SESSION_DAYS * 864e5;
  props.setProperty(sessionKey_(token), JSON.stringify({ email: email, exp: exp }));
  return { token: token, email: email, name: info.name || email, picture: info.picture || '' };
}

function auth_(token) {
  if (!token || typeof token !== 'string') return null;
  const raw = PropertiesService.getScriptProperties().getProperty(sessionKey_(token));
  if (!raw) return null;
  const s = JSON.parse(raw);
  return s.exp > Date.now() ? s : null;
}

function logout_(token) {
  PropertiesService.getScriptProperties().deleteProperty(sessionKey_(token));
  return true;
}

function sessionKey_(token) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, token);
  return 'sess_' + Utilities.base64EncodeWebSafe(bytes);
}

function cleanupSessions_() {
  const props = PropertiesService.getScriptProperties();
  const all = props.getProperties();
  Object.keys(all).forEach(function (k) {
    if (k.indexOf('sess_') !== 0) return;
    try {
      if (JSON.parse(all[k]).exp < Date.now()) props.deleteProperty(k);
    } catch (e) {
      props.deleteProperty(k);
    }
  });
}

// ---------------------------------------------------------------- data

const ACTIONS = {
  getAll: function () {
    const cutoff = Date.now() - DONE_VISIBLE_DAYS * 864e5;
    return {
      projects: readTable_('Projecten'),
      tasks: readTable_('Taken').filter(function (t) {
        return t.status !== 'klaar' || !t.afgerond || Date.parse(t.afgerond) > cutoff;
      }),
    };
  },
  createProject: function (p) { return insert_('Projecten', p, { status: 'actief' }); },
  updateProject: function (p) { return update_('Projecten', p.id, p); },
  deleteProject: function (p) {
    // Taken van het project blijven bestaan, maar worden losgekoppeld.
    readTable_('Taken').forEach(function (t) {
      if (t.projectId === p.id) update_('Taken', t.id, { projectId: '' });
    });
    return remove_('Projecten', p.id);
  },
  createTask: function (p) { return insert_('Taken', p, { type: 'taak', status: 'open' }); },
  updateTask: function (p) { return update_('Taken', p.id, p); },
  deleteTask: function (p) { return remove_('Taken', p.id); },
};

function sheet_(name) {
  const sh = SpreadsheetApp.getActive().getSheetByName(name);
  if (!sh) throw new Error('Tabblad "' + name + '" ontbreekt – voer setup() uit.');
  return sh;
}

function readTable_(name) {
  const sh = sheet_(name);
  const headers = SHEETS[name];
  const n = sh.getLastRow() - 1;
  if (n < 1) return [];
  return sh.getRange(2, 1, n, headers.length).getDisplayValues()
    .filter(function (r) { return r[0]; })
    .map(function (r) {
      const o = {};
      headers.forEach(function (h, i) { o[h] = r[i]; });
      return o;
    });
}

function findRow_(name, id) {
  const sh = sheet_(name);
  const n = sh.getLastRow() - 1;
  if (n < 1) return -1;
  const ids = sh.getRange(2, 1, n, 1).getDisplayValues();
  for (let i = 0; i < ids.length; i++) if (ids[i][0] === id) return i + 2;
  return -1;
}

function clean_(v) {
  if (v === null || v === undefined) return '';
  let s = String(v).slice(0, 5000);
  // voorkom dat tekst als formule geïnterpreteerd wordt
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return s;
}

function validId_(id) {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{6,40}$/.test(id);
}

function insert_(name, data, defaults) {
  const now = new Date().toISOString();
  const obj = {};
  SHEETS[name].forEach(function (h) { obj[h] = ''; });
  Object.keys(defaults).forEach(function (k) { obj[k] = defaults[k]; });
  EDITABLE[name].forEach(function (k) { if (data[k] !== undefined) obj[k] = data[k]; });
  obj.id = validId_(data.id) ? data.id : Utilities.getUuid().slice(0, 12);
  obj.aangemaakt = now;
  if (name === 'Projecten') obj.bijgewerkt = now;
  if (findRow_(name, obj.id) !== -1) throw new Error('Bestaat al: ' + obj.id);
  sheet_(name).appendRow(SHEETS[name].map(function (h) { return clean_(obj[h]); }));
  return obj;
}

function update_(name, id, data) {
  const row = findRow_(name, id);
  if (row === -1) throw new Error('Niet gevonden: ' + id);
  const sh = sheet_(name);
  const headers = SHEETS[name];
  const range = sh.getRange(row, 1, 1, headers.length);
  const values = range.getDisplayValues()[0];
  EDITABLE[name].forEach(function (k) {
    if (data[k] !== undefined) values[headers.indexOf(k)] = data[k];
  });
  if (name === 'Projecten') values[headers.indexOf('bijgewerkt')] = new Date().toISOString();
  range.setValues([values.map(clean_)]);
  const o = {};
  headers.forEach(function (h, i) { o[h] = values[i]; });
  return o;
}

function remove_(name, id) {
  const row = findRow_(name, id);
  if (row === -1) return false;
  sheet_(name).deleteRow(row);
  return true;
}
