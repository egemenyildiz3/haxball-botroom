const fs = require('fs');

function loadOrCreateDatabase(SQL, DB_FILE) {
  if (fs.existsSync(DB_FILE)) {
    const fileContents = fs.readFileSync(DB_FILE);
    return new SQL.Database(new Uint8Array(fileContents));
  }
  return new SQL.Database();
}

function persistDatabase(db, DB_FILE) {
  const data = db.export();
  fs.writeFileSync(DB_FILE, Buffer.from(data));
}

function initDatabase(db) {
  db.exec(`
    DROP TABLE IF EXISTS game_players;

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
      password TEXT NOT NULL,
      isadmin INTEGER DEFAULT 0,
      last_visited_at TEXT
    );

    CREATE TABLE IF NOT EXISTS visited_users (
      username TEXT PRIMARY KEY,
      auth_key TEXT,
      first_visited_at TEXT NOT NULL,
      last_visited_at TEXT
    );

    CREATE TABLE IF NOT EXISTS blacklisted_users (
      username TEXT,
      auth_key TEXT,
      ip TEXT,
      reason TEXT,
      banned_at TEXT
    );

    CREATE TABLE IF NOT EXISTS istekler (
      username TEXT NOT NULL,
      aciklama TEXT NOT NULL,
      date TEXT NOT NULL
    );
  `);

  // Existing Alter Table Migrations
  try { db.exec('ALTER TABLE users ADD COLUMN auth_key TEXT'); } catch (e) {}
  try { db.exec('ALTER TABLE users ADD COLUMN registered_at TEXT'); } catch (e) {}
  try { db.exec('ALTER TABLE users ADD COLUMN last_ip TEXT'); } catch (e) {}
  try { db.exec('ALTER TABLE users ADD COLUMN isadmin INTEGER DEFAULT 0'); } catch (e) {}

  // visited_users & last_visited_at Migrations
  try { db.exec('ALTER TABLE users ADD COLUMN last_visited_at TEXT'); } catch (e) {}
  try { db.exec('ALTER TABLE visited_users ADD COLUMN last_visited_at TEXT'); } catch (e) {}
  try { db.exec('ALTER TABLE visited_users ADD COLUMN auth_key TEXT'); } catch (e) {}

  // İstatistik Sütunları
  try { db.exec('ALTER TABLE users ADD COLUMN goals INTEGER DEFAULT 0'); } catch (e) {}
  try { db.exec('ALTER TABLE users ADD COLUMN assists INTEGER DEFAULT 0'); } catch (e) {}
  try { db.exec('ALTER TABLE users ADD COLUMN wins INTEGER DEFAULT 0'); } catch (e) {}
  try { db.exec('ALTER TABLE users ADD COLUMN losses INTEGER DEFAULT 0'); } catch (e) {}

  migrateIsteklerDropIndexColumn(db);
  migrateBlacklistedUsersIdempotent(db);
}

function tableColumns(db, tableName) {
  const stmt = db.prepare(`PRAGMA table_info(${tableName})`);
  const columns = [];
  while (stmt.step()) columns.push(stmt.getAsObject().name);
  stmt.free();
  return columns;
}

function migrateIsteklerDropIndexColumn(db) {
  try {
    if (!tableColumns(db, 'istekler').includes('index')) return;

    db.exec(`
      BEGIN;
      CREATE TABLE istekler_new (
        username TEXT NOT NULL,
        aciklama TEXT NOT NULL,
        date TEXT NOT NULL
      );
      INSERT INTO istekler_new (username, aciklama, date)
      SELECT username, aciklama, date FROM istekler ORDER BY "index";
      DROP TABLE istekler;
      ALTER TABLE istekler_new RENAME TO istekler;
      COMMIT;
    `);
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch (e) {}
    console.warn('[BACKEND-DB] istekler index kolon migrasyonu başarısız:', err.message);
  }
}

function migrateBlacklistedUsersIdempotent(db) {
  try { db.exec('ALTER TABLE blacklisted_users ADD COLUMN ip TEXT'); } catch (e) {}
  try { db.exec('ALTER TABLE blacklisted_users ADD COLUMN reason TEXT'); } catch (e) {}
  try { db.exec('ALTER TABLE blacklisted_users ADD COLUMN banned_at TEXT'); } catch (e) {}

  try {
    db.exec(`
      DELETE FROM blacklisted_users
      WHERE rowid NOT IN (
        SELECT MIN(rowid)
        FROM blacklisted_users
        WHERE username IS NOT NULL AND TRIM(username) != ''
        GROUP BY LOWER(TRIM(username))
      )
      AND username IS NOT NULL
      AND TRIM(username) != '';
      CREATE UNIQUE INDEX IF NOT EXISTS idx_blacklisted_users_username_unique
      ON blacklisted_users(LOWER(TRIM(username)))
      WHERE username IS NOT NULL AND TRIM(username) != '';
    `);
  } catch (err) {
    console.warn('[BACKEND-DB] blacklist unique username migrasyonu başarısız:', err.message);
  }
}

function isUsernameBlacklisted(db, username) {
  if (!username) return false;

  try {
    const stmt = db.prepare(`
      SELECT 1 FROM blacklisted_users
      WHERE username IS NOT NULL
        AND TRIM(username) != ''
        AND LOWER(TRIM(username)) = LOWER(TRIM(?))
      LIMIT 1
    `);
    stmt.bind([username]);
    const found = stmt.step();
    stmt.free();
    return found;
  } catch (err) {
    console.warn('[BACKEND-DB] Username blacklist kontrolü hatası:', err.message);
    return false;
  }
}

/**
 * Kullanıcının karalistede (blacklisted_users) olup olmadığını kontrol eder.
 */
function isUserBlacklisted(db, username, authKey) {
  if (!username && !authKey) return false;

  try {
    const stmt = db.prepare(`
      SELECT 1 FROM blacklisted_users
      WHERE (username = ? AND username != '')
         OR (auth_key = ? AND auth_key != '')
      LIMIT 1
    `);

    stmt.bind([username || '', authKey || '']);
    const isBlacklisted = stmt.step();
    stmt.free();

    return isBlacklisted;
  } catch (err) {
    console.warn('[BACKEND-DB] Blacklist kontrolü hatası:', err.message);
    return false;
  }
}

/**
 * Odaya giren kullanıcıları visited_users ve users tablolarına kaydeder/günceller.
 */
function logVisitedUser(db, DB_FILE, username, authKey, persistFn) {
  if (!username) return;

  // Parametrelerin kayması ihtimaline karşı persistFn kontrolü
  if (typeof authKey === 'function') {
    persistFn = authKey;
    authKey = '';
  }

  try {
    const now = new Date().toISOString();

    // 1. visited_users tablosuna ekle veya var olan kullanıcının auth_key / last_visited_at alanlarını güncelle
    const stmtVisited = db.prepare(`
      INSERT INTO visited_users (username, auth_key, first_visited_at, last_visited_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(username) DO UPDATE SET
        auth_key = COALESCE(NULLIF(excluded.auth_key, ''), visited_users.auth_key),
        last_visited_at = excluded.last_visited_at
    `);
    stmtVisited.run([username, authKey || '', now, now]);
    stmtVisited.free();

    // 2. Eğer kullanıcı users tablosunda kayıtlı ise onun da last_visited_at alanını güncelle
    const stmtUser = db.prepare('UPDATE users SET last_visited_at = ? WHERE username = ?');
    stmtUser.run([now, username]);
    stmtUser.free();

    if (typeof persistFn === 'function') {
      persistFn(db, DB_FILE);
    }
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

    insertGame.run([
      game.started_at,
      endedAt,
      scores.red,
      scores.blue,
      winnerTeam,
      loserTeam,
      durationSeconds,
    ]);
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
      const isWin = winnerTeam !== null && player.team === winnerTeam ? 1 : 0;
      const isLoss = loserTeam !== null && player.team === loserTeam ? 1 : 0;

      if (player.cleanName) {
        updateUserStats.run([
          player.goals || 0,
          player.assists || 0,
          isWin,
          isLoss,
          player.cleanName,
        ]);
      }
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
    const stmt = db.prepare('INSERT INTO istekler (username, aciklama, date) VALUES (?, ?, ?)');
    stmt.run([username, aciklama, date]);
    stmt.free();

    if (typeof persistFn === 'function') {
      persistFn(db, DB_FILE);
    }

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
  isUsernameBlacklisted,
  isUserBlacklisted,
  logVisitedUser,
  saveGameResult,
  saveAdminRequest,
};
