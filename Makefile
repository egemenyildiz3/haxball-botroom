CONTAINER := haxball-headless

.PHONY: help up down restart rebuild logs logs-backend ps db-users db-drop-users

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

db-game_players:
	docker exec -it $(CONTAINER) node -e "const fs = require('fs'); const initSqlJs = require('sql.js'); initSqlJs().then(SQL => { const db = new SQL.Database(fs.readFileSync('./db/haxball-results.sqlite')); const stmt = db.prepare('SELECT * FROM game_players'); const rows = []; while (stmt.step()) rows.push(stmt.getAsObject()); stmt.free(); console.table(rows); });"

db-visited_users:
	docker exec -it $(CONTAINER) node -e "const fs = require('fs'); const initSqlJs = require('sql.js'); initSqlJs().then(SQL => { const db = new SQL.Database(fs.readFileSync('./db/haxball-results.sqlite')); const stmt = db.prepare('SELECT * FROM visited_users'); const rows = []; while (stmt.step()) rows.push(stmt.getAsObject()); stmt.free(); console.table(rows); });"

db-blacklist:
	docker exec -it $(CONTAINER) node -e "const fs = require('fs'); const initSqlJs = require('sql.js'); initSqlJs().then(SQL => { const db = new SQL.Database(fs.readFileSync('./db/haxball-results.sqlite')); const stmt = db.prepare('SELECT * FROM blacklisted_users'); const rows = []; while (stmt.step()) rows.push(stmt.getAsObject()); stmt.free(); console.table(rows); });"


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
USERNAME ?= sdgsfgg
AUTH ?= sdsd

db-blacklist_player:
	docker exec -it $(CONTAINER) node -e 'const fs = require("fs"); const initSqlJs = require("sql.js"); initSqlJs().then(SQL => { const dbPath = "./db/haxball-results.sqlite"; const db = new SQL.Database(fs.readFileSync(dbPath)); let targetUser = "$(USERNAME)".trim(); let targetAuth = "$(AUTH)".trim(); let ip = ""; if (!targetAuth && targetUser) { const stmtV = db.prepare("SELECT auth_key FROM visited_users WHERE LOWER(username) = LOWER(?) AND auth_key IS NOT NULL AND auth_key != \"\""); stmtV.bind([targetUser]); if (stmtV.step()) { targetAuth = stmtV.getAsObject().auth_key || ""; } stmtV.free(); if (!targetAuth) { const stmtU = db.prepare("SELECT auth_key, last_ip FROM users WHERE LOWER(username) = LOWER(?)"); stmtU.bind([targetUser]); if (stmtU.step()) { const r = stmtU.getAsObject(); targetAuth = r.auth_key || ""; ip = r.last_ip || ""; } stmtU.free(); } } if (!targetUser && !targetAuth) { console.log("⚠️ HATA: Username veya Auth Key belirtilmedi!"); return; } db.run("INSERT INTO blacklisted_users (username, auth_key, ip, reason, banned_at) VALUES (?, ?, ?, ?, ?)", [targetUser, targetAuth, ip, "Makefile üzerinden engellendi", new Date().toISOString()]); fs.writeFileSync(dbPath, Buffer.from(db.export())); console.log("🚫 Blacklist Eklendi -> Kullanıcı: \"" + targetUser + "\" | Auth: \"" + targetAuth + "\""); });'
