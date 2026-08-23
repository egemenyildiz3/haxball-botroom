const fs = require('fs');

const PLAYER_UID_MIN = 100000000;
const PLAYER_UID_MAX = 999999999;

function loadOrCreateDatabase(SQL, DB_FILE) {
  if (!fs.existsSync(DB_FILE)) return new SQL.Database();
  return new SQL.Database(new Uint8Array(fs.readFileSync(DB_FILE)));
}

function persistDatabase(db, DB_FILE) {
  fs.writeFileSync(DB_FILE, Buffer.from(db.export()));
}

function initDatabase(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS games (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at TEXT NOT NULL,
      ended_at TEXT NOT NULL,
      score_red INTEGER NOT NULL,
      score_blue INTEGER NOT NULL,
      winner_team INTEGER,
      loser_team INTEGER,
      duration_seconds REAL NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      username TEXT PRIMARY KEY,
      player_uid TEXT NOT NULL,
      password TEXT NOT NULL,
      auth_key TEXT,
      isadmin INTEGER DEFAULT 0,
      registered_at TEXT,
      last_ip TEXT,
      last_visited_at TEXT,
      goals INTEGER DEFAULT 0,
      assists INTEGER DEFAULT 0,
      wins INTEGER DEFAULT 0,
      losses INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS visited_users (
      username TEXT PRIMARY KEY,
      player_uid TEXT NOT NULL UNIQUE,
      auth_key TEXT,
      first_visited_at TEXT NOT NULL,
      last_visited_at TEXT
    );

    CREATE TABLE IF NOT EXISTS blacklisted_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT,
      player_uid TEXT NOT NULL,
      auth_key TEXT,
      ip TEXT,
      reason TEXT,
      banned_at TEXT
    );

    CREATE TABLE IF NOT EXISTS istekler (
      username TEXT NOT NULL,
      player_uid TEXT NOT NULL,
      aciklama TEXT NOT NULL,
      date TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_users_player_uid ON users(player_uid);
    CREATE INDEX IF NOT EXISTS idx_blacklisted_users_player_uid ON blacklisted_users(player_uid);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_blacklisted_users_username_unique
      ON blacklisted_users(LOWER(TRIM(username)))
      WHERE username IS NOT NULL AND TRIM(username) != '';
    CREATE INDEX IF NOT EXISTS idx_istekler_player_uid ON istekler(player_uid);
  `);
}

function scalar(db, query, params = []) {
  const stmt = db.prepare(query);
  stmt.bind(params);
  let value = null;
  if (stmt.step()) {
    const row = stmt.getAsObject();
    value = row[Object.keys(row)[0]];
  }
  stmt.free();
  return value || null;
}

function randomPlayerUid() {
  return String(PLAYER_UID_MIN + Math.floor(Math.random() * (PLAYER_UID_MAX - PLAYER_UID_MIN + 1)));
}

function playerUidExists(db, playerUid) {
  if (!playerUid) return false;

  return !!scalar(db, `
    SELECT 1 FROM (
      SELECT player_uid FROM visited_users
      UNION ALL SELECT player_uid FROM users
      UNION ALL SELECT player_uid FROM blacklisted_users
      UNION ALL SELECT player_uid FROM istekler
    )
    WHERE player_uid = ?
    LIMIT 1
  `, [playerUid]);
}

function generateUniquePlayerUid(db) {
  for (let attempt = 0; attempt < 1000; attempt++) {
    const candidate = randomPlayerUid();
    if (!playerUidExists(db, candidate)) return candidate;
  }

  throw new Error('Unique player_uid üretilemedi.');
}

function findPlayerUid(db, username, authKey = '') {
  const cleanUsername = String(username || '').trim();
  const cleanAuth = String(authKey || '').trim();

  if (cleanUsername) {
    const found = scalar(db, `
      SELECT player_uid FROM (
        SELECT username, player_uid FROM visited_users
        UNION ALL SELECT username, player_uid FROM users
        UNION ALL SELECT username, player_uid FROM blacklisted_users
        UNION ALL SELECT username, player_uid FROM istekler
      )
      WHERE LOWER(TRIM(username)) = LOWER(TRIM(?))
        AND player_uid IS NOT NULL
        AND TRIM(player_uid) != ''
      LIMIT 1
    `, [cleanUsername]);
    if (found) return String(found);
  }

  if (!cleanUsername && cleanAuth) {
    const found = scalar(db, `
      SELECT player_uid FROM (
        SELECT auth_key, player_uid FROM visited_users
        UNION ALL SELECT auth_key, player_uid FROM users
        UNION ALL SELECT auth_key, player_uid FROM blacklisted_users
      )
      WHERE auth_key = ?
        AND player_uid IS NOT NULL
        AND TRIM(player_uid) != ''
      LIMIT 1
    `, [cleanAuth]);
    if (found) return String(found);
  }

  return null;
}

function getOrCreatePlayerUid(db, username, authKey = '') {
  return findPlayerUid(db, username, authKey) || generateUniquePlayerUid(db);
}

function isUserBlacklisted(db, username, authKey) {
  if (!username && !authKey) return false;

  try {
    const playerUid = findPlayerUid(db, username, authKey);
    const stmt = db.prepare(`
      SELECT 1 FROM blacklisted_users
      WHERE (player_uid = ? AND player_uid IS NOT NULL AND TRIM(player_uid) != '')
         OR (username IS NOT NULL AND TRIM(username) != '' AND LOWER(TRIM(username)) = LOWER(TRIM(?)))
         OR (auth_key = ? AND auth_key != '')
      LIMIT 1
    `);
    stmt.bind([playerUid || '', username || '', authKey || '']);
    const found = stmt.step();
    stmt.free();
    return found;
  } catch (err) {
    console.warn('[BACKEND-DB] Blacklist kontrolü hatası:', err.message);
    return false;
  }
}

function logVisitedUser(db, DB_FILE, username, authKey, persistFn) {
  if (!username) return;
  if (typeof authKey === 'function') {
    persistFn = authKey;
    authKey = '';
  }

  try {
    const now = new Date().toISOString();
    const playerUid = getOrCreatePlayerUid(db, username, authKey);
    const stmtVisited = db.prepare(`
      INSERT INTO visited_users (username, player_uid, auth_key, first_visited_at, last_visited_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(username) DO UPDATE SET
        auth_key = COALESCE(NULLIF(excluded.auth_key, ''), visited_users.auth_key),
        last_visited_at = excluded.last_visited_at,
        player_uid = COALESCE(NULLIF(visited_users.player_uid, ''), excluded.player_uid)
    `);
    stmtVisited.run([username, playerUid, authKey || '', now, now]);
    stmtVisited.free();

    const stmtUser = db.prepare(`
      UPDATE users
      SET last_visited_at = ?,
          player_uid = COALESCE(NULLIF(player_uid, ''), ?)
      WHERE username = ?
    `);
    stmtUser.run([now, playerUid, username]);
    stmtUser.free();

    if (typeof persistFn === 'function') persistFn(db, DB_FILE);
  } catch (err) {
    console.warn('[BACKEND-DB] Visited user kaydedilemedi:', err.message);
  }
}

function saveGameResult(db, DB_FILE, scores, winnerTeam, loserTeam, game, endedAt, durationSeconds, persistFn) {
  if (!game) return;

  try {
    db.exec('BEGIN TRANSACTION');

    const insertGame = db.prepare(`
      INSERT INTO games (started_at, ended_at, score_red, score_blue, winner_team, loser_team, duration_seconds)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `.replace(/\s+/g, ' '));
    insertGame.run([game.started_at, endedAt, scores.red, scores.blue, winnerTeam, loserTeam, durationSeconds]);
    insertGame.free();

    const updateUserStats = db.prepare(`
      UPDATE users
      SET goals = goals + ?,
          assists = assists + ?,
          wins = wins + ?,
          losses = losses + ?
      WHERE username = ?
    `.replace(/\s+/g, ' '));

    for (const player of game.players) {
      if (!player.cleanName) continue;
      const isWin = winnerTeam !== null && player.team === winnerTeam ? 1 : 0;
      const isLoss = loserTeam !== null && player.team === loserTeam ? 1 : 0;
      updateUserStats.run([player.goals || 0, player.assists || 0, isWin, isLoss, player.cleanName]);
    }

    updateUserStats.free();
    db.exec('COMMIT');
    persistFn(db, DB_FILE);
  } catch (error) {
    console.warn('Maç sonucu kaydedilemedi:', error.message);
    try { db.exec('ROLLBACK'); } catch (e) {}
  }
}

function saveAdminRequest(db, DB_FILE, username, aciklama, persistFn) {
  if (!username || !aciklama) {
    return { ok: false, error: 'Eksik kullanıcı veya açıklama.' };
  }

  try {
    const date = new Date().toISOString();
    const playerUid = getOrCreatePlayerUid(db, username);
    const stmt = db.prepare('INSERT INTO istekler (username, player_uid, aciklama, date) VALUES (?, ?, ?, ?)');
    stmt.run([username, playerUid, aciklama, date]);
    stmt.free();

    if (typeof persistFn === 'function') persistFn(db, DB_FILE);
    return { ok: true, date };
  } catch (err) {
    console.warn('[BACKEND-DB] İstek kaydedilemedi:', err.message);
    return { ok: false, error: err.message };
  }
}

module.exports = {
  loadOrCreateDatabase,
  persistDatabase,
  initDatabase,
  isUserBlacklisted,
  getOrCreatePlayerUid,
  logVisitedUser,
  saveGameResult,
  saveAdminRequest,
};
