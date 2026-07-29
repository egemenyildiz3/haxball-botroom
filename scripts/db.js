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
      isadmin INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS visited_users (
      username TEXT PRIMARY KEY,
      first_visited_at TEXT NOT NULL
    );
  `);

  try { db.exec('ALTER TABLE users ADD COLUMN auth_key TEXT'); } catch (e) {}
  try { db.exec('ALTER TABLE users ADD COLUMN registered_at TEXT'); } catch (e) {}
  try { db.exec('ALTER TABLE users ADD COLUMN last_ip TEXT'); } catch (e) {}
  try { db.exec('ALTER TABLE users ADD COLUMN isadmin INTEGER DEFAULT 0'); } catch (e) {}
  
  // İstatistik Sütunları
  try { db.exec('ALTER TABLE users ADD COLUMN goals INTEGER DEFAULT 0'); } catch (e) {}
  try { db.exec('ALTER TABLE users ADD COLUMN assists INTEGER DEFAULT 0'); } catch (e) {}
  try { db.exec('ALTER TABLE users ADD COLUMN wins INTEGER DEFAULT 0'); } catch (e) {}
  try { db.exec('ALTER TABLE users ADD COLUMN losses INTEGER DEFAULT 0'); } catch (e) {}
}

function logVisitedUser(db, DB_FILE, username, persistFn) {
  if (!username) return;

  try {
    const stmt = db.prepare('INSERT OR IGNORE INTO visited_users (username, first_visited_at) VALUES (?, ?)');
    stmt.run([username, new Date().toISOString()]);
    stmt.free();

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

module.exports = {
  loadOrCreateDatabase,
  persistDatabase,
  initDatabase,
  logVisitedUser,
  saveGameResult,
};