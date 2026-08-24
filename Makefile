CONTAINER := haxball-headless
V3_CONTAINER := haxball-headless-v3
DB_FILE := db/haxball-results.sqlite
SHARED_DB_FILE := db/haxball-shared.sqlite
V3_DB_FILE := db/haxball-v3-results.sqlite
FILE_STORAGE_DIR := /home/egemen/file-storage/haxball
DB_BACKUP_DIR := $(FILE_STORAGE_DIR)/backups
LOG_DIR := logs/v4
V3_LOG_DIR := logs/v3
TOKEN_FILE := $(FILE_STORAGE_DIR)/spacebounce-v4-token.txt
CRON_LOG := $(DB_BACKUP_DIR)/cron.log
BACKUP ?=
LIMIT ?= 50
EVENT ?=
LEVEL ?=

.PHONY: help up up-v3 down down-v3 ps logs logs-f logs-v3 logs-v3-f logs-backend logs-chat logs-json logs-json-f logs-json-v3 logs-json-v3-f logs-json-errors logs-json-player logs-json-event attach attach-v3 token-file-init cron-install-db-backup cron-show db-all db-users db-user-stats db-games db-visited_users db-istekler db-blacklist db-users-today db-visited_users-today db-ljungberg db-make-superadmin db-user-with-auth db-blacklist-player db-unblacklist-player db-backup db-backups db-restore

help:
	@echo "======================================================================"
	@echo "                HAXBALL BOTROOM - MAKEFILE KOMUTLARI                  "
	@echo "======================================================================"
	@echo "  make up            : Konteynerleri arka planda başlatır"
	@echo "  make up-v3         : V3 odasını profile ile arka planda başlatır"
	@echo "  make down          : Konteynerleri durdurur ve kaldırır"
	@echo "  make down-v3       : Sadece V3 odasını durdurur ve kaldırır"
	@echo "  make restart       : Konteyneri yeniden başlatır"
	@echo "  make rebuild       : Image'ı yeniden derleyip konteyneri başlatır"
	@echo "  make ps            : Çalışan konteyner durumunu gösterir"
	@echo "----------------------------------------------------------------------"
	@echo "  make logs          : Canlı konteyner loglarını izler"
	@echo "  make logs-f        : Canlı konteyner loglarını takip eder"
	@echo "  make logs-v3       : V3 konteyner loglarını izler"
	@echo "  make logs-v3-f     : V3 konteyner loglarını takip eder"
	@echo "  make logs-backend  : Sadece [BACKEND-DB] veritabanı loglarını filtreler"
	@echo "  make logs-chat     : Sadece [CHAT] loglarını filtreler"
	@echo "  make logs-json     : JSONL operasyon loglarını tablo olarak gösterir"
	@echo "  make logs-json-f   : Bugünün JSONL log dosyasını canlı takip eder"
	@echo "  make logs-json-v3  : V3 JSONL operasyon loglarını tablo olarak gösterir"
	@echo "  make logs-json-v3-f : V3 bugünün JSONL log dosyasını canlı takip eder"
	@echo "  make logs-json-errors : JSONL error loglarını gösterir"
	@echo "  make logs-json-player USERNAME='oyuncu' : Oyuncuya göre JSONL log arar"
	@echo "  make logs-json-event EVENT='goal' : Event tipine göre JSONL log arar"
	@echo "  make attach        : Konteyner terminaline bağlanır"
	@echo "  make attach-v3     : V3 konteyner terminaline bağlanır"
	@echo "----------------------------------------------------------------------"
	@echo "  make token-file-init : .env içindeki tokenı file-storage token dosyasına yazar"
	@echo "  make cron-install-db-backup : Her gün 12:00 DB backup cron satırını kurar/günceller"
	@echo "  make cron-show     : Mevcut crontab kayıtlarını gösterir"
	@echo "----------------------------------------------------------------------"
	@echo "  make db-all        : V4 oda SQLite tablolarını listeler"
	@echo "  make db-users      : shared 'users' tablosundaki tüm kayıtları listeler"
	@echo "  make db-user-stats : 'user_stats' tablosundaki tüm istatistikleri listeler"
	@echo "  make db-games      : 'games' tablosundaki tüm kayıtları listeler"
	@echo "  make db-visited_users : shared 'visited_users' tablosundaki tüm kayıtları listeler"
	@echo "  make db-istekler   : 'istekler' tablosundaki tüm kayıtları listeler"
	@echo "  make db-blacklist  : shared 'blacklisted_users' tablosundaki kayıtları listeler"
	@echo "  make db-users-today : Bugün görülen users kayıtlarını listeler"
	@echo "  make db-visited_users-today : Bugün gelen visited_users kayıtlarını listeler"
	@echo "  make db-user-with-auth USERNAME='oyuncu' : Oyuncunun auth bilgisini gösterir"
	@echo "----------------------------------------------------------------------"
	@echo "  make db-make-superadmin USERNAME='oyuncu' : Kullanıcı rolünü owner yapar"
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

up-v3:
	docker compose --profile v3 up -d --build haxball-v3

down:
	docker compose down

down-v3:
	docker compose --profile v3 stop haxball-v3
	docker compose --profile v3 rm -f haxball-v3

ps:
	docker compose ps

# --- Log İzleme Komutları ---

logs:
	docker logs --tail 50 $(CONTAINER)

logs-f:
	docker logs -f $(CONTAINER)

logs-v3:
	docker logs --tail 50 $(V3_CONTAINER)

logs-v3-f:
	docker logs -f $(V3_CONTAINER)

logs-backend:
	docker logs -f $(CONTAINER) | grep --line-buffered "\[BACKEND-DB\]"

logs-chat:
	docker logs -f $(CONTAINER) | grep --line-buffered "\[CHAT\]"

logs-json:
	@LOG_DIR="$(LOG_DIR)" LIMIT="$(LIMIT)" node scripts/tools/logQuery.js

logs-json-f:
	@mkdir -p "$(LOG_DIR)"
	@touch "$(LOG_DIR)/room-$$(date +%F).jsonl"
	tail -f "$(LOG_DIR)/room-$$(date +%F).jsonl"

logs-json-v3:
	@LOG_DIR="$(V3_LOG_DIR)" LIMIT="$(LIMIT)" node scripts/tools/logQuery.js

logs-json-v3-f:
	@mkdir -p "$(V3_LOG_DIR)"
	@touch "$(V3_LOG_DIR)/room-$$(date +%F).jsonl"
	tail -f "$(V3_LOG_DIR)/room-$$(date +%F).jsonl"

logs-json-errors:
	@LOG_DIR="$(LOG_DIR)" LIMIT="$(LIMIT)" LEVEL="error" node scripts/tools/logQuery.js

logs-json-player:
	@if [ -z "$(USERNAME)" ]; then echo "⚠️ HATA: USERNAME belirtilmedi! Örnek: make logs-json-player USERNAME='Longman'"; exit 1; fi
	@LOG_DIR="$(LOG_DIR)" LIMIT="$(LIMIT)" USERNAME="$(USERNAME)" node scripts/tools/logQuery.js

logs-json-event:
	@if [ -z "$(EVENT)" ]; then echo "⚠️ HATA: EVENT belirtilmedi! Örnek: make logs-json-event EVENT='goal'"; exit 1; fi
	@LOG_DIR="$(LOG_DIR)" LIMIT="$(LIMIT)" EVENT="$(EVENT)" node scripts/tools/logQuery.js

attach:
	docker attach haxball-headless

attach-v3:
	docker attach $(V3_CONTAINER)

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
			const db = new SQL.Database(fs.readFileSync('./$(DB_FILE)')); \
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
			const db = new SQL.Database(fs.readFileSync('./$(SHARED_DB_FILE)')); \
			const stmt = db.prepare('SELECT * FROM users'); \
			const rows = []; \
			while (stmt.step()) rows.push(stmt.getAsObject()); \
			stmt.free(); \
			console.table(rows); \
		});"

db-user-stats:
	docker exec -it $(CONTAINER) node -e "\
		const fs = require('fs'); \
		const initSqlJs = require('sql.js'); \
		initSqlJs().then(SQL => { \
			const db = new SQL.Database(fs.readFileSync('./$(DB_FILE)')); \
			const stmt = db.prepare('SELECT * FROM user_stats ORDER BY wins DESC, goals DESC, username COLLATE NOCASE ASC'); \
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
			const db = new SQL.Database(fs.readFileSync('./$(DB_FILE)')); \
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
			const db = new SQL.Database(fs.readFileSync('./$(SHARED_DB_FILE)')); \
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
			const db = new SQL.Database(fs.readFileSync('./$(DB_FILE)')); \
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
			const db = new SQL.Database(fs.readFileSync('./$(SHARED_DB_FILE)')); \
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
			const db = new SQL.Database(fs.readFileSync('./$(SHARED_DB_FILE)')); \
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
			const db = new SQL.Database(fs.readFileSync('./$(SHARED_DB_FILE)')); \
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
			const db = new SQL.Database(fs.readFileSync('./$(SHARED_DB_FILE)')); \
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
			const dbPath = './$(SHARED_DB_FILE)'; \
			const db = new SQL.Database(fs.readFileSync(dbPath)); \
			db.run('UPDATE users SET role = ? WHERE username = ?', ['owner', '$(USERNAME)']); \
			fs.writeFileSync(dbPath, Buffer.from(db.export())); \
			console.log('$(USERNAME) kullanıcısı owner yapıldı.'); \
		});"


db-user-with-auth:
	docker exec -it $(CONTAINER) node -e "\
		const fs = require('fs'); \
		const initSqlJs = require('sql.js'); \
		initSqlJs().then(SQL => { \
			const db = new SQL.Database(fs.readFileSync('./$(SHARED_DB_FILE)')); \
			const stmt = db.prepare('SELECT username, auth_key FROM visited_users WHERE username = ?;'); \
			stmt.bind(['$(USERNAME)']); \
			const rows = []; \
			while (stmt.step()) rows.push(stmt.getAsObject()); \
			stmt.free(); \
			console.table(rows); \
		});"

# KARA LISTE
USERNAME ?=
AUTH ?=
REASON ?=
UNBLACKLIST_USERNAME := $(strip $(if $(USERNAME),$(USERNAME),$(word 2,$(MAKECMDGOALS))))

ifneq ($(filter db-unblacklist-player,$(MAKECMDGOALS)),)
$(eval $(wordlist 2,$(words $(MAKECMDGOALS)),$(MAKECMDGOALS)):;@:)
endif

# make db-blacklist-player USERNAME='FOK BALIĞI' REASON='dini küfür'
db-blacklist-player:
	@if [ -z "$(USERNAME)$(AUTH)" ]; then echo "⚠️ HATA: USERNAME veya AUTH belirtilmedi! Örnek: make db-blacklist-player USERNAME='oyuncu' REASON='sebep'"; exit 1; fi
	docker exec -e TARGET_USERNAME="$(USERNAME)" -e TARGET_AUTH="$(AUTH)" -e REASON="$(REASON)" -i $(CONTAINER) node < scripts/tools/dbBlacklistPlayer.js

db-unblacklist-player: # USERNAME=player1
	@if [ -z "$(UNBLACKLIST_USERNAME)" ]; then echo "⚠️ HATA: USERNAME belirtilmedi! Örnek: make db-unblacklist-player USERNAME='oyuncu' veya make db-unblacklist-player oyuncu"; exit 1; fi
	docker exec -e TARGET_USERNAME="$(UNBLACKLIST_USERNAME)" -i $(CONTAINER) node < scripts/tools/dbUnblacklistPlayer.js



# DB backup
db-backup:
	@set -e; \
	mkdir -p "$(DB_BACKUP_DIR)"; \
	ts=$$(date +%Y%m%d-%H%M%S); \
	for source in "$(DB_FILE)" "$(SHARED_DB_FILE)" "$(V3_DB_FILE)"; do \
		if [ ! -f "$$source" ]; then continue; fi; \
		name=$$(basename "$$source" .sqlite); \
		backup="$(DB_BACKUP_DIR)/$$name-$$ts.sqlite"; \
		tmp="$$backup.tmp"; \
		cp -p "$$source" "$$tmp"; \
		node -e 'const fs = require("fs"); const initSqlJs = require("sql.js"); const file = process.argv[1]; initSqlJs().then(SQL => { const db = new SQL.Database(fs.readFileSync(file)); db.exec("SELECT name FROM sqlite_master LIMIT 1"); db.close(); }).catch((err) => { console.error("⚠️ Backup doğrulaması başarısız:", err.message); process.exit(1); });' "$$tmp"; \
		mv "$$tmp" "$$backup"; \
		echo "✅ DB backup alındı: $$backup"; \
	done

db-backups:
	@mkdir -p "$(DB_BACKUP_DIR)"
	@find "$(DB_BACKUP_DIR)" -maxdepth 1 -type f -name 'haxball-*.sqlite' -printf '%TY-%Tm-%Td %TH:%TM  %s bytes  %p\n' | sort

db-restore:
	@if [ -z "$(BACKUP)" ]; then echo "⚠️ HATA: BACKUP belirtilmedi! Örnek: make db-restore BACKUP='$(DB_BACKUP_DIR)/haxball-results-YYYYMMDD-HHMMSS.sqlite'"; exit 1; fi
	@if [ ! -f "$(BACKUP)" ]; then echo "⚠️ HATA: Backup bulunamadı: $(BACKUP)"; exit 1; fi
	@if docker inspect -f '{{.State.Running}}' $(CONTAINER) 2>/dev/null | grep -q true; then echo "⚠️ HATA: Container çalışırken restore yapılmadı. Önce odayı bilinçli şekilde durdur."; exit 1; fi
	@node -e 'const fs = require("fs"); const initSqlJs = require("sql.js"); const file = process.argv[1]; initSqlJs().then(SQL => { const db = new SQL.Database(fs.readFileSync(file)); db.exec("SELECT name FROM sqlite_master LIMIT 1"); db.close(); }).catch((err) => { console.error("⚠️ Backup doğrulaması başarısız:", err.message); process.exit(1); });' "$(BACKUP)"
	@mkdir -p "$(dir $(DB_FILE))"
	@cp -p "$(BACKUP)" "$(DB_FILE)"
	@echo "✅ DB restore edildi: $(BACKUP) -> $(DB_FILE)"
