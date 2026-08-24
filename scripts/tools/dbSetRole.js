const fs = require('fs');
const initSqlJs = require('sql.js');

const DB_PATH = process.env.HAXBALL_SHARED_DB_FILE || './db/haxball-shared.sqlite';
const VALID_ROLES = new Set(['player', 'vip', 'mod', 'admin', 'owner']);

function fail(message) {
  console.error(`⚠️ HATA: ${message}`);
  process.exit(1);
}

initSqlJs().then((SQL) => {
  const username = String(process.env.TARGET_USERNAME || '').trim();
  const role = String(process.env.TARGET_ROLE || '').trim().toLowerCase();

  if (!username) fail('USERNAME belirtilmedi.');
  if (!VALID_ROLES.has(role)) fail(`ROLE geçersiz. Geçerli roller: ${Array.from(VALID_ROLES).join(', ')}`);
  if (!fs.existsSync(DB_PATH)) fail(`Shared DB bulunamadı: ${DB_PATH}`);

  const db = new SQL.Database(fs.readFileSync(DB_PATH));
  const stmt = db.prepare('SELECT username, role FROM users WHERE LOWER(TRIM(username)) = LOWER(TRIM(?)) LIMIT 1');
  stmt.bind([username]);
  const found = stmt.step() ? stmt.getAsObject() : null;
  stmt.free();

  if (!found) fail(`Kullanıcı bulunamadı: ${username}`);

  db.run('UPDATE users SET role = ? WHERE LOWER(TRIM(username)) = LOWER(TRIM(?))', [role, username]);
  fs.writeFileSync(DB_PATH, Buffer.from(db.export()));
  db.close();

  console.log(`✅ ${found.username} rolü güncellendi: ${found.role || 'player'} -> ${role}`);
}).catch((err) => {
  fail(err.message);
});
