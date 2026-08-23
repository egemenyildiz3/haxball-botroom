CONTAINER := haxball-headless
DB_FILE := db/haxball-results.sqlite
DB_BACKUP_DIR := /home/egemen/file-storage/haxball-botroom-db-backups
BACKUP ?=

.PHONY: help up down ps logs logs-f logs-backend logs-chat attach db-all db-users db-games db-visited_users db-istekler db-blacklist db-users-today db-visited_users-today db-ljungberg db-make-superadmin db-user-with-auth db-blacklist-player db-unblacklist-player db-backup db-backups db-restore

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
	@echo "  make logs-f        : Canlı konteyner loglarını takip eder"
	@echo "  make logs-backend  : Sadece [BACKEND-DB] veritabanı loglarını filtreler"
	@echo "  make logs-chat     : Sadece [CHAT] loglarını filtreler"
	@echo "  make attach        : Konteyner terminaline bağlanır"
	@echo "----------------------------------------------------------------------"
	@echo "  make db-all        : SQLite tablolarını listeler"
	@echo "  make db-users      : 'users' tablosundaki tüm kayıtları listeler"
	@echo "  make db-games      : 'games' tablosundaki tüm kayıtları listeler"
	@echo "  make db-visited_users : 'visited_users' tablosundaki tüm kayıtları listeler"
	@echo "  make db-istekler   : 'istekler' tablosundaki tüm kayıtları listeler"
	@echo "  make db-blacklist  : 'blacklisted_users' tablosundaki kayıtları listeler"
	@echo "  make db-users-today : Bugün görülen users kayıtlarını listeler"
	@echo "  make db-visited_users-today : Bugün gelen visited_users kayıtlarını listeler"
	@echo "  make db-user-with-auth USERNAME='oyuncu' : Oyuncunun auth bilgisini gösterir"
	@echo "----------------------------------------------------------------------"
	@echo "  make db-make-superadmin USERNAME='oyuncu' : Kullanıcıyı Kurucu yapar"
	@echo "  make db-blacklist-player USERNAME='oyuncu' REASON='sebep' : Kullanıcıyı kara listeye ekler"
	@echo "  make db-unblacklist-player USERNAME='oyuncu' : Kullanıcıyı kara listeden çıkarır"
	@echo "----------------------------------------------------------------------"
	@echo "  make db-backup     : SQLite veritabanının timestamp'li yedeğini alır"
	@echo "  make db-backups    : Alınmış veritabanı yedeklerini listeler"
	@echo "  make db-restore BACKUP='$(DB_BACKUP_DIR)/...' : Seçilen yedeği geri yükler"
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

logs-chat:
	docker logs -f $(CONTAINER) | grep --line-buffered "\[CHAT\]"

attach:
	docker attach haxball-headless

# --- SQLite Veritabanı Komutları ---

db-all:
	docker exec -it $(CONTAINER) node -e "\
		const fs = require('fs'); \
		const initSqlJs = require('sql.js'); \
		initSqlJs().then(SQL => { \
			const db = new SQL.Database(fs.readFileSync('./db/haxball-results.sqlite')); \
			const stmt = db.prepare(\"SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'\"); \
			const rows = []; \
			while (stmt.step()) rows.push(stmt.getAsObject()); \
			stmt.free(); \
			console.table(rows); \
		});"

db-users:
	docker exec -it $(CONTAINER) node -e "\
		const fs = require('fs'); \
		const initSqlJs = require('sql.js'); \
		initSqlJs().then(SQL => { \
			const db = new SQL.Database(fs.readFileSync('./db/haxball-results.sqlite')); \
			const stmt = db.prepare('SELECT * FROM users'); \
			const rows = []; \
			while (stmt.step()) rows.push(stmt.getAsObject()); \
			stmt.free(); \
			console.table(rows); \
		});"

db-games:
	docker exec -it $(CONTAINER) node -e "\
		const fs = require('fs'); \
		const initSqlJs = require('sql.js'); \
		initSqlJs().then(SQL => { \
			const db = new SQL.Database(fs.readFileSync('./db/haxball-results.sqlite')); \
			const stmt = db.prepare('SELECT * FROM games'); \
			const rows = []; \
			while (stmt.step()) rows.push(stmt.getAsObject()); \
			stmt.free(); \
			console.table(rows); \
		});"

db-visited_users:
	docker exec -it $(CONTAINER) node -e "\
		const fs = require('fs'); \
		const initSqlJs = require('sql.js'); \
		initSqlJs().then(SQL => { \
			const db = new SQL.Database(fs.readFileSync('./db/haxball-results.sqlite')); \
			const stmt = db.prepare('SELECT * FROM visited_users'); \
			const rows = []; \
			while (stmt.step()) rows.push(stmt.getAsObject()); \
			stmt.free(); \
			console.table(rows); \
		});"

db-istekler:
	docker exec -it $(CONTAINER) node -e "\
		const fs = require('fs'); \
		const initSqlJs = require('sql.js'); \
		initSqlJs().then(SQL => { \
			const db = new SQL.Database(fs.readFileSync('./db/haxball-results.sqlite')); \
			const stmt = db.prepare('SELECT rowid, username, aciklama, date FROM istekler'); \
			const rows = []; \
			while (stmt.step()) rows.push(stmt.getAsObject()); \
			stmt.free(); \
			console.table(rows); \
		});"

db-blacklist:
	docker exec -it $(CONTAINER) node -e "\
		const fs = require('fs'); \
		const initSqlJs = require('sql.js'); \
		initSqlJs().then(SQL => { \
			const db = new SQL.Database(fs.readFileSync('./db/haxball-results.sqlite')); \
			const stmt = db.prepare('SELECT * FROM blacklisted_users'); \
			const rows = []; \
			while (stmt.step()) rows.push(stmt.getAsObject()); \
			stmt.free(); \
			console.table(rows); \
		});"

db-users-today:
	docker exec -it $(CONTAINER) node -e "\
		const fs = require('fs'); \
		const initSqlJs = require('sql.js'); \
		initSqlJs().then(SQL => { \
			const db = new SQL.Database(fs.readFileSync('./db/haxball-results.sqlite')); \
			const stmt = db.prepare(\"SELECT * FROM users WHERE date(last_visited_at) = date('now')\"); \
			const rows = []; \
			while (stmt.step()) rows.push(stmt.getAsObject()); \
			stmt.free(); \
			console.table(rows); \
		});"

db-visited_users-today:
	docker exec -it $(CONTAINER) node -e "\
		const fs = require('fs'); \
		const initSqlJs = require('sql.js'); \
		initSqlJs().then(SQL => { \
			const db = new SQL.Database(fs.readFileSync('./db/haxball-results.sqlite')); \
			const stmt = db.prepare(\"SELECT * FROM visited_users WHERE date(last_visited_at) = date('now') ORDER BY last_visited_at;\"); \
			const rows = []; \
			while (stmt.step()) rows.push(stmt.getAsObject()); \
			stmt.free(); \
			console.table(rows); \
		});"

db-ljungberg:
	docker exec -it $(CONTAINER) node -e "\
		const fs = require('fs'); \
		const initSqlJs = require('sql.js'); \
		initSqlJs().then(SQL => { \
			const db = new SQL.Database(fs.readFileSync('./db/haxball-results.sqlite')); \
			const stmt = db.prepare(\"SELECT username, last_visited_at FROM users WHERE username='Ljungberg';\"); \
			const rows = []; \
			while (stmt.step()) rows.push(stmt.getAsObject()); \
			stmt.free(); \
			console.table(rows); \
		});"

# --- DANGER ZONE ---

db-make-superadmin: #USERNAME=player1
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


db-user-with-auth:
	docker exec -it $(CONTAINER) node -e "\
		const fs = require('fs'); \
		const initSqlJs = require('sql.js'); \
		initSqlJs().then(SQL => { \
			const db = new SQL.Database(fs.readFileSync('./db/haxball-results.sqlite')); \
			const stmt = db.prepare('SELECT username, auth_key FROM visited_users WHERE username = ?;'); \
			stmt.bind(['$(USERNAME)']); \
			const rows = []; \
			while (stmt.step()) rows.push(stmt.getAsObject()); \
			stmt.free(); \
			console.table(rows); \
		});"

# KARA LISTE
USERNAME ?= ayak müptelası
AUTH ?=
REASON ?= xxx
UNBLACKLIST_USERNAME := $(strip $(if $(USERNAME),$(USERNAME),$(word 2,$(MAKECMDGOALS))))

ifneq ($(filter db-unblacklist-player,$(MAKECMDGOALS)),)
$(eval $(wordlist 2,$(words $(MAKECMDGOALS)),$(MAKECMDGOALS)):;@:)
endif

db-blacklist-player:
	docker exec -it $(CONTAINER) node -e '\
		const fs = require("fs"); \
		const initSqlJs = require("sql.js"); \
		initSqlJs().then(SQL => { \
			const dbPath = "./db/haxball-results.sqlite"; \
			const db = new SQL.Database(fs.readFileSync(dbPath)); \
			let targetUser = "$(USERNAME)".trim(); \
			let targetAuth = "$(AUTH)".trim(); \
			let reason = "$(REASON)".trim(); \
			let ip = ""; \
			if (!targetAuth && targetUser) { \
				const stmtV = db.prepare("SELECT auth_key FROM visited_users WHERE LOWER(username) = LOWER(?) AND auth_key IS NOT NULL AND auth_key != \"\""); \
				stmtV.bind([targetUser]); \
				if (stmtV.step()) targetAuth = stmtV.getAsObject().auth_key || ""; \
				stmtV.free(); \
				if (!targetAuth) { \
					const stmtU = db.prepare("SELECT auth_key, last_ip FROM users WHERE LOWER(username) = LOWER(?)"); \
					stmtU.bind([targetUser]); \
					if (stmtU.step()) { \
						const r = stmtU.getAsObject(); \
						targetAuth = r.auth_key || ""; \
						ip = r.last_ip || ""; \
					} \
					stmtU.free(); \
				} \
			} \
			if (!targetUser && !targetAuth) { \
				console.log("⚠️ HATA: Username veya Auth Key belirtilmedi!"); \
				return; \
			} \
			const exists = db.prepare("SELECT 1 FROM blacklisted_users WHERE username IS NOT NULL AND TRIM(username) != \"\" AND LOWER(TRIM(username)) = LOWER(TRIM(?)) LIMIT 1"); \
			exists.bind([targetUser]); \
			const already = exists.step(); \
			exists.free(); \
			if (already) { \
				console.log("ℹ️ Bu oyuncu zaten karalistede -> Kullanıcı: \"" + targetUser + "\""); \
				return; \
			} \
			db.run("INSERT INTO blacklisted_users (username, auth_key, ip, reason, banned_at) VALUES (?, ?, ?, ?, ?)", [targetUser, targetAuth, ip, reason, new Date().toISOString()]); \
			fs.writeFileSync(dbPath, Buffer.from(db.export())); \
			console.log("🚫 Blacklist Eklendi -> Kullanıcı: \"" + targetUser + "\" | Auth: \"" + targetAuth + "\" | Sebep: \"" + reason + "\""); \
		});'

db-unblacklist-player: # USERNAME=player1
	@if [ -z "$(UNBLACKLIST_USERNAME)" ]; then echo "⚠️ HATA: USERNAME belirtilmedi! Örnek: make db-unblacklist_player USERNAME='oyuncu' veya make db-unblacklist_player oyuncu"; exit 1; fi
	docker exec -e TARGET_USERNAME="$(UNBLACKLIST_USERNAME)" -it $(CONTAINER) node -e '\
		const fs = require("fs"); \
		const initSqlJs = require("sql.js"); \
		initSqlJs().then(SQL => { \
			const dbPath = "./db/haxball-results.sqlite"; \
			const db = new SQL.Database(fs.readFileSync(dbPath)); \
			const targetUser = (process.env.TARGET_USERNAME || "").trim(); \
			if (!targetUser) { \
				console.log("⚠️ HATA: USERNAME belirtilmedi!"); \
				return; \
			} \
			const auths = new Set(); \
			for (const query of [ \
				"SELECT auth_key FROM visited_users WHERE LOWER(username) = LOWER(?) AND auth_key IS NOT NULL AND auth_key != \"\"", \
				"SELECT auth_key FROM users WHERE LOWER(username) = LOWER(?) AND auth_key IS NOT NULL AND auth_key != \"\"" \
			]) { \
				const stmt = db.prepare(query); \
				stmt.bind([targetUser]); \
				while (stmt.step()) auths.add(stmt.getAsObject().auth_key || ""); \
				stmt.free(); \
			} \
			const authParams = Array.from(auths); \
			const authSql = authParams.length ? " OR auth_key IN (" + authParams.map(() => "?").join(",") + ")" : ""; \
			const params = [targetUser, ...authParams]; \
			const countStmt = db.prepare("SELECT COUNT(*) AS count FROM blacklisted_users WHERE LOWER(username) = LOWER(?)" + authSql); \
			countStmt.bind(params); \
			countStmt.step(); \
			const before = countStmt.getAsObject().count || 0; \
			countStmt.free(); \
			db.run("DELETE FROM blacklisted_users WHERE LOWER(username) = LOWER(?)" + authSql, params); \
			fs.writeFileSync(dbPath, Buffer.from(db.export())); \
			console.log("✅ Blacklist kaldırıldı -> Kullanıcı: \"" + targetUser + "\" | Silinen kayıt: " + before); \
		});'



# DB backup
db-backup:
	@set -e; \
	if [ ! -f "$(DB_FILE)" ]; then echo "⚠️ HATA: $(DB_FILE) bulunamadı."; exit 1; fi; \
	mkdir -p "$(DB_BACKUP_DIR)"; \
	ts=$$(date +%Y%m%d-%H%M%S); \
	backup="$(DB_BACKUP_DIR)/haxball-results-$$ts.sqlite"; \
	tmp="$$backup.tmp"; \
	cp -p "$(DB_FILE)" "$$tmp"; \
	node -e '\
		const fs = require("fs"); \
		const initSqlJs = require("sql.js"); \
		const file = process.argv[1]; \
		initSqlJs() \
			.then(SQL => { \
				const db = new SQL.Database(fs.readFileSync(file)); \
				db.exec("SELECT name FROM sqlite_master LIMIT 1"); \
				db.close(); \
			}) \
			.catch((err) => { \
				console.error("⚠️ Backup doğrulaması başarısız:", err.message); \
				process.exit(1); \
			});' "$$tmp"; \
	mv "$$tmp" "$$backup"; \
	echo "✅ DB backup alındı: $$backup"

db-backups:
	@mkdir -p "$(DB_BACKUP_DIR)"
	@find "$(DB_BACKUP_DIR)" -maxdepth 1 -type f -name 'haxball-results-*.sqlite' -printf '%TY-%Tm-%Td %TH:%TM  %s bytes  %p\n' | sort

db-restore:
	@if [ -z "$(BACKUP)" ]; then echo "⚠️ HATA: BACKUP belirtilmedi! Örnek: make db-restore BACKUP='$(DB_BACKUP_DIR)/haxball-results-YYYYMMDD-HHMMSS.sqlite'"; exit 1; fi
	@if [ ! -f "$(BACKUP)" ]; then echo "⚠️ HATA: Backup bulunamadı: $(BACKUP)"; exit 1; fi
	@if docker inspect -f '{{.State.Running}}' $(CONTAINER) 2>/dev/null | grep -q true; then echo "⚠️ HATA: Container çalışırken restore yapılmadı. Önce odayı bilinçli şekilde durdur."; exit 1; fi
	@node -e '\
		const fs = require("fs"); \
		const initSqlJs = require("sql.js"); \
		const file = process.argv[1]; \
		initSqlJs() \
			.then(SQL => { \
				const db = new SQL.Database(fs.readFileSync(file)); \
				db.exec("SELECT name FROM sqlite_master LIMIT 1"); \
				db.close(); \
			}) \
			.catch((err) => { \
				console.error("⚠️ Backup doğrulaması başarısız:", err.message); \
				process.exit(1); \
			});' "$(BACKUP)"
	@mkdir -p "$(dir $(DB_FILE))"
	@cp -p "$(BACKUP)" "$(DB_FILE)"
	@echo "✅ DB restore edildi: $(BACKUP) -> $(DB_FILE)"
