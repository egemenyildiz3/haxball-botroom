const fs = require("fs");
const initSqlJs = require("sql.js");

const DB_PATH = process.env.HAXBALL_SHARED_DB_FILE || "./db/haxball-shared.sqlite";

function getEnv(name) {
  return (process.env[name] || "").trim();
}

function scalar(db, query, params = []) {
  const stmt = db.prepare(query);
  stmt.bind(params);
  const value = stmt.step() ? Object.values(stmt.getAsObject())[0] : "";
  stmt.free();
  return value || "";
}

function uidExists(db, uid) {
  return scalar(
    db,
    `
      SELECT 1
      FROM (
        SELECT player_uid FROM users
        UNION ALL SELECT player_uid FROM visited_users
        UNION ALL SELECT player_uid FROM blacklisted_users
      )
      WHERE player_uid = ?
      LIMIT 1
    `,
    [uid],
  );
}

function makeUid(db) {
  for (let i = 0; i < 10000; i += 1) {
    const uid = String(100000000 + Math.floor(Math.random() * 900000000));
    if (!uidExists(db, uid)) return uid;
  }
  throw new Error("Unique player_uid üretilemedi");
}

function findUid(db, username) {
  if (!username) return "";

  const queries = [
    "SELECT player_uid FROM visited_users WHERE LOWER(TRIM(username)) = LOWER(TRIM(?)) AND player_uid IS NOT NULL AND TRIM(player_uid) != '' LIMIT 1",
    "SELECT player_uid FROM users WHERE LOWER(TRIM(username)) = LOWER(TRIM(?)) AND player_uid IS NOT NULL AND TRIM(player_uid) != '' LIMIT 1",
  ];

  for (const query of queries) {
    const uid = scalar(db, query, [username]);
    if (uid) return uid;
  }

  return "";
}

function findIdentity(db, username) {
  if (!username) return { auth: "", ip: "" };

  const visitedStmt = db.prepare(
    "SELECT auth_key FROM visited_users WHERE LOWER(TRIM(username)) = LOWER(TRIM(?)) AND auth_key IS NOT NULL AND TRIM(auth_key) != '' LIMIT 1",
  );
  visitedStmt.bind([username]);
  if (visitedStmt.step()) {
    const auth = visitedStmt.getAsObject().auth_key || "";
    visitedStmt.free();
    return { auth, ip: "" };
  }
  visitedStmt.free();

  const userStmt = db.prepare(
    "SELECT auth_key FROM users WHERE LOWER(TRIM(username)) = LOWER(TRIM(?)) LIMIT 1",
  );
  userStmt.bind([username]);
  if (userStmt.step()) {
    const row = userStmt.getAsObject();
    userStmt.free();
    return { auth: row.auth_key || "", ip: "" };
  }
  userStmt.free();

  return { auth: "", ip: "" };
}

initSqlJs().then((SQL) => {
  const db = new SQL.Database(fs.readFileSync(DB_PATH));
  const targetUser = getEnv("TARGET_USERNAME") || getEnv("USERNAME");
  let targetAuth = getEnv("TARGET_AUTH") || getEnv("AUTH");
  const reason = getEnv("REASON");
  let ip = "";

  if (!targetAuth && targetUser) {
    const identity = findIdentity(db, targetUser);
    targetAuth = identity.auth;
    ip = identity.ip;
  }

  if (!targetUser && !targetAuth) {
    console.log("⚠️ HATA: Username veya Auth Key belirtilmedi!");
    return;
  }

  const targetUid = findUid(db, targetUser) || makeUid(db);
  const exists = db.prepare(`
    SELECT 1
    FROM blacklisted_users
    WHERE (
      username IS NOT NULL
      AND TRIM(username) != ''
      AND LOWER(TRIM(username)) = LOWER(TRIM(?))
    )
      OR (
        player_uid = ?
        AND player_uid IS NOT NULL
        AND TRIM(player_uid) != ''
      )
      OR (
        auth_key = ?
        AND auth_key IS NOT NULL
        AND TRIM(auth_key) != ''
      )
    LIMIT 1
  `);
  exists.bind([targetUser, targetUid, targetAuth]);
  const already = exists.step();
  exists.free();

  if (already) {
    console.log(`ℹ️ Bu oyuncu zaten karalistede -> Kullanıcı: "${targetUser}"`);
    return;
  }

  db.run(
    "INSERT INTO blacklisted_users (username, player_uid, auth_key, ip, reason, banned_at) VALUES (?, ?, ?, ?, ?, ?)",
    [targetUser, targetUid, targetAuth, ip, reason, new Date().toISOString()],
  );
  fs.writeFileSync(DB_PATH, Buffer.from(db.export()));

  console.log(
    `🚫 Blacklist Eklendi -> Kullanıcı: "${targetUser}" | UID: "${targetUid}" | Auth: "${targetAuth}" | Sebep: "${reason}"`,
  );
});
