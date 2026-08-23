const fs = require("fs");
const initSqlJs = require("sql.js");

const DB_PATH = "./db/haxball-results.sqlite";

function getEnv(name) {
  return (process.env[name] || "").trim();
}

initSqlJs().then((SQL) => {
  const db = new SQL.Database(fs.readFileSync(DB_PATH));
  const targetUser = getEnv("TARGET_USERNAME") || getEnv("USERNAME");

  if (!targetUser) {
    console.log("⚠️ HATA: USERNAME belirtilmedi!");
    return;
  }

  const auths = new Set();
  const uids = new Set();
  const queries = [
    "SELECT auth_key, player_uid FROM visited_users WHERE LOWER(TRIM(username)) = LOWER(TRIM(?))",
    "SELECT auth_key, player_uid FROM users WHERE LOWER(TRIM(username)) = LOWER(TRIM(?))",
    "SELECT auth_key, player_uid FROM blacklisted_users WHERE LOWER(TRIM(username)) = LOWER(TRIM(?))",
    "SELECT '' AS auth_key, player_uid FROM istekler WHERE LOWER(TRIM(username)) = LOWER(TRIM(?))",
  ];

  for (const query of queries) {
    const stmt = db.prepare(query);
    stmt.bind([targetUser]);
    while (stmt.step()) {
      const row = stmt.getAsObject();
      if (row.auth_key) auths.add(row.auth_key);
      if (row.player_uid) uids.add(row.player_uid);
    }
    stmt.free();
  }

  const authParams = Array.from(auths);
  const uidParams = Array.from(uids);
  const authSql = authParams.length
    ? ` OR auth_key IN (${authParams.map(() => "?").join(",")})`
    : "";
  const uidSql = uidParams.length
    ? ` OR player_uid IN (${uidParams.map(() => "?").join(",")})`
    : "";
  const params = [targetUser, ...authParams, ...uidParams];

  const countStmt = db.prepare(
    `SELECT COUNT(*) AS count FROM blacklisted_users WHERE LOWER(TRIM(username)) = LOWER(TRIM(?))${authSql}${uidSql}`,
  );
  countStmt.bind(params);
  countStmt.step();
  const before = countStmt.getAsObject().count || 0;
  countStmt.free();

  db.run(
    `DELETE FROM blacklisted_users WHERE LOWER(TRIM(username)) = LOWER(TRIM(?))${authSql}${uidSql}`,
    params,
  );
  fs.writeFileSync(DB_PATH, Buffer.from(db.export()));

  console.log(
    `✅ Blacklist kaldırıldı -> Kullanıcı: "${targetUser}" | Silinen kayıt: ${before}`,
  );
});
