CONTAINER := haxball-headless

.PHONY: help up down restart rebuild logs logs-backend ps db-users db-drop-users db-blacklist db-blacklist_player db-unblacklist_player

help:
	@echo "======================================================================"
	@echo "                HAXBALL BOTROOM - MAKEFILE KOMUTLARI                  "
	@echo "======================================================================"
	@echo "  make up            : Konteynerleri arka planda başlatır"
	@echo "  make down          : Konteynerleri durdurur ve kaldırır"
	@echo "  make restart       : Konteyneri yeniden başlatır"
	@echo "  make rebuild       : Image'ı yeniden derleyip konteyneri başlatır"
	@echo "  make ps            : Çalışan konteyner durumunu gösterir"
	@echo "----------------------------------------------------------------------"
	@echo "  make logs          : Canlı konteyner loglarını izler"
	@echo "  make logs-backend  : Sadece [BACKEND-DB] veritabanı loglarını filtreler"
	@echo "----------------------------------------------------------------------"
	@echo "  make db-users      : 'users' tablosundaki tüm kayıtları listeler"
	@echo "  make db-drop-users : 'users' tablosunu tamamen siler (DROP TABLE)"
	@echo "  make db-blacklist  : 'blacklisted_users' tablosundaki kayıtları listeler"
	@echo "  make db-unblacklist_player USERNAME='oyuncu' : Kullanıcıyı kara listeden çıkarır"
	@echo "======================================================================"

# --- Docker Compose Komutları ---

up:
	docker compose up -d --build

down:
	docker compose down

ps:
	docker compose ps

# --- Log İzleme Komutları ---

logs:
	docker logs --tail 50 $(CONTAINER)

logs-f:
	docker logs -f $(CONTAINER)

logs-backend:
	docker logs -f $(CONTAINER) | grep --line-buffered "\[BACKEND-DB\]"

make attach:
	docker attach haxball-headless

# --- SQLite Veritabanı Komutları ---

db-all:
	docker exec -it $(CONTAINER) node -e "const fs = require('fs'); const initSqlJs = require('sql.js'); initSqlJs().then(SQL => { const db = new SQL.Database(fs.readFileSync('./db/haxball-results.sqlite')); const stmt = db.prepare(\"SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'\"); const rows = []; while (stmt.step()) rows.push(stmt.getAsObject()); stmt.free(); console.table(rows); });"

db-users:
	docker exec -it $(CONTAINER) node -e "const fs = require('fs'); const initSqlJs = require('sql.js'); initSqlJs().then(SQL => { const db = new SQL.Database(fs.readFileSync('./db/haxball-results.sqlite')); const stmt = db.prepare('SELECT * FROM users'); const rows = []; while (stmt.step()) rows.push(stmt.getAsObject()); stmt.free(); console.table(rows); });"

db-games:
	docker exec -it $(CONTAINER) node -e "const fs = require('fs'); const initSqlJs = require('sql.js'); initSqlJs().then(SQL => { const db = new SQL.Database(fs.readFileSync('./db/haxball-results.sqlite')); const stmt = db.prepare('SELECT * FROM games'); const rows = []; while (stmt.step()) rows.push(stmt.getAsObject()); stmt.free(); console.table(rows); });"

db-visited_users:
	docker exec -it $(CONTAINER) node -e "const fs = require('fs'); const initSqlJs = require('sql.js'); initSqlJs().then(SQL => { const db = new SQL.Database(fs.readFileSync('./db/haxball-results.sqlite')); const stmt = db.prepare('SELECT * FROM visited_users'); const rows = []; while (stmt.step()) rows.push(stmt.getAsObject()); stmt.free(); console.table(rows); });"

db-istekler:
	docker exec -it $(CONTAINER) node -e "const fs = require('fs'); const initSqlJs = require('sql.js'); initSqlJs().then(SQL => { const db = new SQL.Database(fs.readFileSync('./db/haxball-results.sqlite')); const stmt = db.prepare('SELECT * FROM istekler'); const rows = []; while (stmt.step()) rows.push(stmt.getAsObject()); stmt.free(); console.table(rows); });"

db-blacklist:
	docker exec -it $(CONTAINER) node -e "const fs = require('fs'); const initSqlJs = require('sql.js'); initSqlJs().then(SQL => { const db = new SQL.Database(fs.readFileSync('./db/haxball-results.sqlite')); const stmt = db.prepare('SELECT * FROM blacklisted_users'); const rows = []; while (stmt.step()) rows.push(stmt.getAsObject()); stmt.free(); console.table(rows); });"

db-users-today:
	docker exec -it $(CONTAINER) node -e "const fs = require('fs'); const initSqlJs = require('sql.js'); initSqlJs().then(SQL => { const db = new SQL.Database(fs.readFileSync('./db/haxball-results.sqlite')); const stmt = db.prepare(\"SELECT * FROM users WHERE date(last_visited_at) = date('now')\"); const rows = []; while (stmt.step()) rows.push(stmt.getAsObject()); stmt.free(); console.table(rows); });"

db-visited_users-today:
	docker exec -it $(CONTAINER) node -e "const fs = require('fs'); const initSqlJs = require('sql.js'); initSqlJs().then(SQL => { const db = new SQL.Database(fs.readFileSync('./db/haxball-results.sqlite')); const stmt = db.prepare(\"SELECT * FROM visited_users WHERE date(last_visited_at) = date('now')\"); const rows = []; while (stmt.step()) rows.push(stmt.getAsObject()); stmt.free(); console.table(rows); });"

db-users-Ljungberg:
	docker exec -it $(CONTAINER) node -e "const fs = require('fs'); const initSqlJs = require('sql.js'); initSqlJs().then(SQL => { const db = new SQL.Database(fs.readFileSync('./db/haxball-results.sqlite')); const stmt = db.prepare(\"SELECT username, last_visited_at FROM users WHERE username='Ljungberg';\"); const rows = []; while (stmt.step()) rows.push(stmt.getAsObject()); stmt.free(); console.table(rows); });"
# --- DANGER ZONE ---

db-make_admin: #USERNAME=player1
	docker exec -it $(CONTAINER) node -e "\
		const fs = require('fs'); \
		const initSqlJs = require('sql.js'); \
		initSqlJs().then(SQL => { \
			const dbPath = './db/haxball-results.sqlite'; \
			const db = new SQL.Database(fs.readFileSync(dbPath)); \
			db.run('UPDATE users SET isadmin = 1 WHERE username = ?', ['$(USERNAME)']); \
			fs.writeFileSync(dbPath, Buffer.from(db.export())); \
			console.log('$(USERNAME) kullanıcısı admin yapıldı.'); \
		});"


# KARA LISTE
USERNAME ?=
AUTH ?=
UNBLACKLIST_USERNAME := $(strip $(if $(USERNAME),$(USERNAME),$(word 2,$(MAKECMDGOALS))))

ifneq ($(filter db-unblacklist_player,$(MAKECMDGOALS)),)
$(eval $(wordlist 2,$(words $(MAKECMDGOALS)),$(MAKECMDGOALS)):;@:)
endif

db-blacklist_player:
	docker exec -it $(CONTAINER) node -e 'const fs = require("fs"); const initSqlJs = require("sql.js"); initSqlJs().then(SQL => { const dbPath = "./db/haxball-results.sqlite"; const db = new SQL.Database(fs.readFileSync(dbPath)); let targetUser = "$(USERNAME)".trim(); let targetAuth = "$(AUTH)".trim(); let ip = ""; if (!targetAuth && targetUser) { const stmtV = db.prepare("SELECT auth_key FROM visited_users WHERE LOWER(username) = LOWER(?) AND auth_key IS NOT NULL AND auth_key != \"\""); stmtV.bind([targetUser]); if (stmtV.step()) { targetAuth = stmtV.getAsObject().auth_key || ""; } stmtV.free(); if (!targetAuth) { const stmtU = db.prepare("SELECT auth_key, last_ip FROM users WHERE LOWER(username) = LOWER(?)"); stmtU.bind([targetUser]); if (stmtU.step()) { const r = stmtU.getAsObject(); targetAuth = r.auth_key || ""; ip = r.last_ip || ""; } stmtU.free(); } } if (!targetUser && !targetAuth) { console.log("⚠️ HATA: Username veya Auth Key belirtilmedi!"); return; } db.run("INSERT INTO blacklisted_users (username, auth_key, ip, reason, banned_at) VALUES (?, ?, ?, ?, ?)", [targetUser, targetAuth, ip, "Makefile üzerinden engellendi", new Date().toISOString()]); fs.writeFileSync(dbPath, Buffer.from(db.export())); console.log("🚫 Blacklist Eklendi -> Kullanıcı: \"" + targetUser + "\" | Auth: \"" + targetAuth + "\""); });'

db-unblacklist_player: # USERNAME=player1
	@if [ -z "$(UNBLACKLIST_USERNAME)" ]; then echo "⚠️ HATA: USERNAME belirtilmedi! Örnek: make db-unblacklist_player USERNAME='oyuncu' veya make db-unblacklist_player oyuncu"; exit 1; fi
	docker exec -e TARGET_USERNAME="$(UNBLACKLIST_USERNAME)" -it $(CONTAINER) node -e 'const fs = require("fs"); const initSqlJs = require("sql.js"); initSqlJs().then(SQL => { const dbPath = "./db/haxball-results.sqlite"; const db = new SQL.Database(fs.readFileSync(dbPath)); const targetUser = (process.env.TARGET_USERNAME || "").trim(); if (!targetUser) { console.log("⚠️ HATA: USERNAME belirtilmedi!"); return; } const auths = new Set(); for (const query of ["SELECT auth_key FROM visited_users WHERE LOWER(username) = LOWER(?) AND auth_key IS NOT NULL AND auth_key != \"\"", "SELECT auth_key FROM users WHERE LOWER(username) = LOWER(?) AND auth_key IS NOT NULL AND auth_key != \"\""]) { const stmt = db.prepare(query); stmt.bind([targetUser]); while (stmt.step()) auths.add(stmt.getAsObject().auth_key || ""); stmt.free(); } const countStmt = db.prepare("SELECT COUNT(*) AS count FROM blacklisted_users WHERE LOWER(username) = LOWER(?)" + (auths.size ? " OR auth_key IN (" + Array.from(auths).map(() => "?").join(",") + ")" : "")); const params = [targetUser, ...Array.from(auths)]; countStmt.bind(params); countStmt.step(); const before = countStmt.getAsObject().count || 0; countStmt.free(); db.run("DELETE FROM blacklisted_users WHERE LOWER(username) = LOWER(?)" + (auths.size ? " OR auth_key IN (" + Array.from(auths).map(() => "?").join(",") + ")" : ""), params); fs.writeFileSync(dbPath, Buffer.from(db.export())); console.log("✅ Blacklist kaldırıldı -> Kullanıcı: \"" + targetUser + "\" | Silinen kayıt: " + before); });'
