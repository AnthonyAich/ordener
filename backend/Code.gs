/**
 * Ordener – Apps Script backend
 *
 * Koppel dit script aan een Google Sheet (Extensies > Apps Script) en
 * deploy het als Web app (Uitvoeren als: ik, Toegang: iedereen).
 * De toegang wordt afgeschermd met een wachtwoord.
 *
 * Wachtwoord instellen of wijzigen:
 *   Projectinstellingen (⚙) > Scripteigenschappen > eigenschap PASSWORD toevoegen
 *   met je wachtwoord als waarde. Bij de eerste login wordt het gehasht opgeslagen
 *   (PASSWORD_HASH + PASSWORD_SALT) en wordt PASSWORD automatisch verwijderd.
 *   Bij een wijziging worden alle bestaande sessies uitgelogd.
 */

// Nieuwe kolommen altijd ACHTERAAN toevoegen: bestaande data blijft zo op z'n plaats.
// werktype: 'hw' = Hardware Assistent, 'ip' = Improvement Projects. duur: minuten.
const SHEETS = {
  Projecten: ['id', 'naam', 'doel', 'status', 'deadline', 'aangemaakt', 'bijgewerkt', 'werktype'],
  Taken: ['id', 'titel', 'type', 'projectId', 'status', 'vandaag', 'deadline', 'notitie', 'aangemaakt', 'afgerond',
    'werktype', 'duur'],
  Dagnotities: ['id', 'notitie', 'aangemaakt', 'bijgewerkt'], // id = datum (YYYY-MM-DD)
};

const EDITABLE = {
  Projecten: ['naam', 'doel', 'status', 'deadline', 'werktype'],
  Taken: ['titel', 'type', 'projectId', 'status', 'vandaag', 'deadline', 'notitie', 'afgerond', 'werktype', 'duur'],
  Dagnotities: ['notitie'],
};

const SESSION_DAYS = 30;

// ---------------------------------------------------------------- setup

/** Eén keer manueel uitvoeren vanuit de editor. Mag later opnieuw (veilig). */
function setup() {
  const ss = SpreadsheetApp.getActive();
  Object.keys(SHEETS).forEach(function (name) { ensureSheet_(name); });
  const def = ss.getSheetByName('Sheet1') || ss.getSheetByName('Blad1');
  if (def && def.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(def);

  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('PASSWORD') && !props.getProperty('PASSWORD_HASH')) {
    Logger.log('Klaar. Voeg nu de scripteigenschap PASSWORD toe en deploy als Web app.');
  } else {
    Logger.log('Klaar. Deploy als Web app.');
  }
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
    if (req.action === 'login') return json_({ ok: true, data: login_(req.password) });

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

const MAX_FAILS = 5;          // foute pogingen ...
const LOCK_MINUTES = 15;      // ... binnen dit venster → tijdelijk geblokkeerd

function login_(password) {
  const cache = CacheService.getScriptCache();
  const fails = Number(cache.get('login_fails') || 0);
  if (fails >= MAX_FAILS) throw new Error('locked');

  const props = PropertiesService.getScriptProperties();
  adoptNewPassword_(props);
  const hash = props.getProperty('PASSWORD_HASH');
  const salt = props.getProperty('PASSWORD_SALT');
  if (!hash || !salt) throw new Error('no_password');

  if (typeof password !== 'string' || !password || !safeEqual_(hashPassword_(password, salt), hash)) {
    cache.put('login_fails', String(fails + 1), LOCK_MINUTES * 60);
    Utilities.sleep(800); // vertraag raden
    throw new Error('forbidden');
  }
  cache.remove('login_fails');

  cleanupSessions_();
  const token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  const exp = Date.now() + SESSION_DAYS * 864e5;
  props.setProperty(sessionKey_(token), JSON.stringify({ exp: exp }));
  return { token: token };
}

/** Zet een (nieuw) PASSWORD uit de scripteigenschappen om naar hash + salt. */
function adoptNewPassword_(props) {
  const plain = props.getProperty('PASSWORD');
  if (!plain) return;
  const salt = Utilities.getUuid() + Utilities.getUuid();
  props.setProperty('PASSWORD_SALT', salt);
  props.setProperty('PASSWORD_HASH', hashPassword_(plain, salt));
  props.deleteProperty('PASSWORD');
  // nieuw wachtwoord → alle bestaande sessies ongeldig
  Object.keys(props.getProperties()).forEach(function (k) {
    if (k.indexOf('sess_') === 0) props.deleteProperty(k);
  });
}

function hashPassword_(password, salt) {
  const key = Utilities.newBlob(salt).getBytes();
  let h = Utilities.computeHmacSha256Signature(password, salt);
  for (let i = 0; i < 1000; i++) h = Utilities.computeHmacSha256Signature(h, key);
  return Utilities.base64Encode(h);
}

function safeEqual_(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
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
    // Alle taken, ook oude afgeronde: die zijn nodig voor de agenda en het dashboard.
    return {
      projects: readTable_('Projecten'),
      tasks: readTable_('Taken'),
      dayNotes: readTable_('Dagnotities'),
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
  /** Dagnotitie bewaren (of verwijderen als ze leeg is). */
  saveDayNote: function (p) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(p.id))) throw new Error('Ongeldige datum');
    const tekst = String(p.notitie || '');
    const exists = findRow_('Dagnotities', p.id) !== -1;
    if (!tekst.trim()) {
      if (exists) remove_('Dagnotities', p.id);
      return null;
    }
    return exists ? update_('Dagnotities', p.id, { notitie: tekst }) : insert_('Dagnotities', { id: p.id, notitie: tekst }, {});
  },
};

/** Maakt een tabblad aan en/of vult ontbrekende kolomkoppen aan (migratie). */
function ensureSheet_(name) {
  const ss = SpreadsheetApp.getActive();
  const headers = SHEETS[name];
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  const current = sh.getRange(1, 1, 1, headers.length).getDisplayValues()[0];
  if (current.join('|') !== headers.join('|')) {
    sh.getRange(1, 1, sh.getMaxRows(), headers.length).setNumberFormat('@');
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

const sheetCache_ = {};
function sheet_(name) {
  if (!sheetCache_[name]) sheetCache_[name] = ensureSheet_(name);
  return sheetCache_[name];
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

const hasCol_ = function (name, col) { return SHEETS[name].indexOf(col) !== -1; };

function insert_(name, data, defaults) {
  const now = new Date().toISOString();
  const obj = {};
  SHEETS[name].forEach(function (h) { obj[h] = ''; });
  Object.keys(defaults).forEach(function (k) { obj[k] = defaults[k]; });
  EDITABLE[name].forEach(function (k) { if (data[k] !== undefined) obj[k] = data[k]; });
  obj.id = validId_(data.id) ? data.id : Utilities.getUuid().slice(0, 12);
  obj.aangemaakt = now;
  if (hasCol_(name, 'bijgewerkt')) obj.bijgewerkt = now;
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
  if (hasCol_(name, 'bijgewerkt')) values[headers.indexOf('bijgewerkt')] = new Date().toISOString();
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
