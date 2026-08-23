CONTAINER := haxball-headless
DB_FILE := db/haxball-results.sqlite
FILE_STORAGE_DIR := /home/egemen/file-storage/haxball
DB_BACKUP_DIR := $(FILE_STORAGE_DIR)/backups
TOKEN_FILE := $(FILE_STORAGE_DIR)/spacebounce-botroom-token.txt
CRON_LOG := $(DB_BACKUP_DIR)/cron.log
BACKUP ?=

.PHONY: help up down ps logs logs-f logs-backend logs-chat attach token-file-init cron-install-db-backup cron-show db-all db-users db-games db-visited_users db-istekler db-blacklist db-users-today db-visited_users-today db-ljungberg db-make-superadmin db-user-with-auth db-blacklist-player db-unblacklist-player db-backup db-backups db-restore

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
	@echo "  make token-file-init : .env içindeki tokenı file-storage token dosyasına yazar"
	@echo "  make cron-install-db-backup : Her gün 12:00 DB backup cron satırını kurar/günceller"
	@echo "  make cron-show     : Mevcut crontab kayıtlarını gösterir"
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

# --- Operasyon / Token / Cron ---

token-file-init:
	@set -e; \
	mkdir -p "$(FILE_STORAGE_DIR)"; \
	token=$$(awk -F= '/^HAXBALL_TOKEN=/{print substr($$0, index($$0, "=") + 1)}' .env 2>/dev/null | tail -1 | sed 's/^"//; s/"$$//; s/^'\''//; s/'\''$$//'); \
	if [ -z "$$token" ]; then echo "⚠️ HATA: .env içinde HAXBALL_TOKEN bulunamadı."; exit 1; fi; \
	printf "%s\n" "$$token" > "$(TOKEN_FILE)"; \
	chmod 600 "$(TOKEN_FILE)"; \
	echo "✅ Token dosyası hazırlandı: $(TOKEN_FILE)"

cron-install-db-backup:
	@set -e; \
	mkdir -p "$(DB_BACKUP_DIR)"; \
	tmp=$$(mktemp); \
	crontab -l 2>/dev/null | grep -v 'haxball-botroom.*make db-backup' > "$$tmp" || true; \
	printf '%s\n' '0 12 * * * cd /home/egemen/homelab/haxball-botroom && /usr/bin/make db-backup >> $(CRON_LOG) 2>&1' >> "$$tmp"; \
	crontab "$$tmp"; \
	rm -f "$$tmp"; \
	echo "✅ DB backup cron kuruldu: her gün 12:00 -> $(DB_BACKUP_DIR)"

cron-show:
	@crontab -l

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
			const stmt = db.prepare('SELECT rowid, username, player_uid, aciklama, date FROM istekler'); \
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
			const scalar = (query, params) => { const stmt = db.prepare(query); stmt.bind(params); const value = stmt.step() ? Object.values(stmt.getAsObject())[0] : ""; stmt.free(); return value || ""; }; \
			const uidExists = (uid) => scalar("SELECT 1 FROM (SELECT player_uid FROM users UNION ALL SELECT player_uid FROM visited_users UNION ALL SELECT player_uid FROM blacklisted_users UNION ALL SELECT player_uid FROM istekler) WHERE player_uid = ? LIMIT 1", [uid]); \
			const makeUid = () => { for (let i = 0; i < 10000; i++) { const uid = String(100000000 + Math.floor(Math.random() * 900000000)); if (!uidExists(uid)) return uid; } throw new Error("Unique player_uid üretilemedi"); }; \
			const findUid = (username) => { if (!username) return ""; return scalar("SELECT player_uid FROM visited_users WHERE LOWER(TRIM(username)) = LOWER(TRIM(?)) AND player_uid IS NOT NULL AND TRIM(player_uid) != \"\" LIMIT 1", [username]) || scalar("SELECT player_uid FROM users WHERE LOWER(TRIM(username)) = LOWER(TRIM(?)) AND player_uid IS NOT NULL AND TRIM(player_uid) != \"\" LIMIT 1", [username]) || scalar("SELECT player_uid FROM istekler WHERE LOWER(TRIM(username)) = LOWER(TRIM(?)) AND player_uid IS NOT NULL AND TRIM(player_uid) != \"\" LIMIT 1", [username]) || ""; }; \
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
			const targetUid = findUid(targetUser) || makeUid(); \
			const exists = db.prepare("SELECT 1 FROM blacklisted_users WHERE (username IS NOT NULL AND TRIM(username) != \"\" AND LOWER(TRIM(username)) = LOWER(TRIM(?))) OR (player_uid = ? AND player_uid IS NOT NULL AND TRIM(player_uid) != \"\") OR (auth_key = ? AND auth_key IS NOT NULL AND TRIM(auth_key) != \"\") LIMIT 1"); \
			exists.bind([targetUser, targetUid, targetAuth]); \
			const already = exists.step(); \
			exists.free(); \
			if (already) { \
				console.log("ℹ️ Bu oyuncu zaten karalistede -> Kullanıcı: \"" + targetUser + "\""); \
				return; \
			} \
			db.run("INSERT INTO blacklisted_users (username, player_uid, auth_key, ip, reason, banned_at) VALUES (?, ?, ?, ?, ?, ?)", [targetUser, targetUid, targetAuth, ip, reason, new Date().toISOString()]); \
			fs.writeFileSync(dbPath, Buffer.from(db.export())); \
			console.log("🚫 Blacklist Eklendi -> Kullanıcı: \"" + targetUser + "\" | UID: \"" + targetUid + "\" | Auth: \"" + targetAuth + "\" | Sebep: \"" + reason + "\""); \
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
			const uids = new Set(); \
			for (const query of [ \
				"SELECT auth_key, player_uid FROM visited_users WHERE LOWER(username) = LOWER(?)", \
				"SELECT auth_key, player_uid FROM users WHERE LOWER(username) = LOWER(?)", \
				"SELECT auth_key, player_uid FROM blacklisted_users WHERE LOWER(username) = LOWER(?)", \
				"SELECT \"\" AS auth_key, player_uid FROM istekler WHERE LOWER(username) = LOWER(?)" \
			]) { \
				const stmt = db.prepare(query); \
				stmt.bind([targetUser]); \
				while (stmt.step()) { const row = stmt.getAsObject(); if (row.auth_key) auths.add(row.auth_key); if (row.player_uid) uids.add(row.player_uid); } \
				stmt.free(); \
			} \
			const authParams = Array.from(auths); \
			const uidParams = Array.from(uids); \
			const authSql = authParams.length ? " OR auth_key IN (" + authParams.map(() => "?").join(",") + ")" : ""; \
			const uidSql = uidParams.length ? " OR player_uid IN (" + uidParams.map(() => "?").join(",") + ")" : ""; \
			const params = [targetUser, ...authParams, ...uidParams]; \
			const countStmt = db.prepare("SELECT COUNT(*) AS count FROM blacklisted_users WHERE LOWER(username) = LOWER(?)" + authSql + uidSql); \
			countStmt.bind(params); \
			countStmt.step(); \
			const before = countStmt.getAsObject().count || 0; \
			countStmt.free(); \
			db.run("DELETE FROM blacklisted_users WHERE LOWER(username) = LOWER(?)" + authSql + uidSql, params); \
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
	node -e 'const fs = require("fs"); const initSqlJs = require("sql.js"); const file = process.argv[1]; initSqlJs().then(SQL => { const db = new SQL.Database(fs.readFileSync(file)); db.exec("SELECT name FROM sqlite_master LIMIT 1"); db.close(); }).catch((err) => { console.error("⚠️ Backup doğrulaması başarısız:", err.message); process.exit(1); });' "$$tmp"; \
	mv "$$tmp" "$$backup"; \
	echo "✅ DB backup alındı: $$backup"

db-backups:
	@mkdir -p "$(DB_BACKUP_DIR)"
	@find "$(DB_BACKUP_DIR)" -maxdepth 1 -type f -name 'haxball-results-*.sqlite' -printf '%TY-%Tm-%Td %TH:%TM  %s bytes  %p\n' | sort

db-restore:
	@if [ -z "$(BACKUP)" ]; then echo "⚠️ HATA: BACKUP belirtilmedi! Örnek: make db-restore BACKUP='$(DB_BACKUP_DIR)/haxball-results-YYYYMMDD-HHMMSS.sqlite'"; exit 1; fi
	@if [ ! -f "$(BACKUP)" ]; then echo "⚠️ HATA: Backup bulunamadı: $(BACKUP)"; exit 1; fi
	@if docker inspect -f '{{.State.Running}}' $(CONTAINER) 2>/dev/null | grep -q true; then echo "⚠️ HATA: Container çalışırken restore yapılmadı. Önce odayı bilinçli şekilde durdur."; exit 1; fi
	@node -e 'const fs = require("fs"); const initSqlJs = require("sql.js"); const file = process.argv[1]; initSqlJs().then(SQL => { const db = new SQL.Database(fs.readFileSync(file)); db.exec("SELECT name FROM sqlite_master LIMIT 1"); db.close(); }).catch((err) => { console.error("⚠️ Backup doğrulaması başarısız:", err.message); process.exit(1); });' "$(BACKUP)"
	@mkdir -p "$(dir $(DB_FILE))"
	@cp -p "$(BACKUP)" "$(DB_FILE)"
	@echo "✅ DB restore edildi: $(BACKUP) -> $(DB_FILE)"
