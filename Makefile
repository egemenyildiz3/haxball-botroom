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
V3_TOKEN_FILE := $(FILE_STORAGE_DIR)/spacebounce-v3-token.txt
CRON_LOG := $(DB_BACKUP_DIR)/cron.log
BACKUP ?=
LIMIT ?= 50
EVENT ?=
LEVEL ?=

.PHONY: help up up-v3 down down-v3 restart restart-v3 rebuild rebuild-v3 ps logs logs-f logs-v3 logs-v3-f logs-backend logs-backend-v3 logs-chat logs-chat-v3 logs-json logs-json-f logs-json-v3 logs-json-v3-f logs-json-errors logs-json-errors-v3 logs-json-player logs-json-player-v3 logs-json-event logs-json-event-v3 attach attach-v3 token-file-init token-file-init-v3 cron-install-db-backup cron-show db-all db-all-v3 db-users db-user-stats db-user-stats-v3 db-games db-games-v3 db-visited_users db-istekler db-istekler-v3 db-blacklist db-users-today db-visited_users-today db-ljungberg db-set-role db-make-superadmin db-make-admin db-make-mod db-make-vip db-make-player db-user-with-auth db-blacklist-player db-unblacklist-player db-backup db-backup-v3 db-backups db-restore db-restore-v3

help:
	@echo "======================================================================"
	@echo "                HAXBALL BOTROOM - MAKEFILE KOMUTLARI                  "
	@echo "======================================================================"
	@echo "  make up            : Konteynerleri arka planda başlatır"
	@echo "  make up-v3         : V3 odasını profile ile arka planda başlatır"
	@echo "  make down          : Konteynerleri durdurur ve kaldırır"
	@echo "  make down-v3       : Sadece V3 odasını durdurur ve kaldırır"
	@echo "  make restart       : Konteyneri yeniden başlatır"
	@echo "  make restart-v3    : V3 konteynerini yeniden başlatır"
	@echo "  make rebuild       : Image'ı yeniden derleyip konteyneri başlatır"
	@echo "  make rebuild-v3    : Image'ı yeniden derleyip V3 konteynerini başlatır"
	@echo "  make ps            : Çalışan konteyner durumunu gösterir"
	@echo "----------------------------------------------------------------------"
	@echo "  make logs          : Canlı konteyner loglarını izler"
	@echo "  make logs-f        : Canlı konteyner loglarını takip eder"
	@echo "  make logs-v3       : V3 konteyner loglarını izler"
	@echo "  make logs-v3-f     : V3 konteyner loglarını takip eder"
	@echo "  make logs-backend  : Sadece [BACKEND-DB] veritabanı loglarını filtreler"
	@echo "  make logs-backend-v3 : V3 [BACKEND-DB] veritabanı loglarını filtreler"
	@echo "  make logs-chat     : Sadece [CHAT] loglarını filtreler"
	@echo "  make logs-chat-v3  : V3 [CHAT] loglarını filtreler"
	@echo "  make logs-json     : JSONL operasyon loglarını tablo olarak gösterir"
	@echo "  make logs-json-f   : Bugünün JSONL log dosyasını canlı takip eder"
	@echo "  make logs-json-v3  : V3 JSONL operasyon loglarını tablo olarak gösterir"
	@echo "  make logs-json-v3-f : V3 bugünün JSONL log dosyasını canlı takip eder"
	@echo "  make logs-json-errors : JSONL error loglarını gösterir"
	@echo "  make logs-json-errors-v3 : V3 JSONL error loglarını gösterir"
	@echo "  make logs-json-player USERNAME='oyuncu' : Oyuncuya göre JSONL log arar"
	@echo "  make logs-json-player-v3 USERNAME='oyuncu' : V3 oyuncuya göre JSONL log arar"
	@echo "  make logs-json-event EVENT='goal' : Event tipine göre JSONL log arar"
	@echo "  make logs-json-event-v3 EVENT='goal' : V3 event tipine göre JSONL log arar"
	@echo "  make attach        : Konteyner terminaline bağlanır"
	@echo "  make attach-v3     : V3 konteyner terminaline bağlanır"
	@echo "----------------------------------------------------------------------"
	@echo "  make token-file-init : .env içindeki tokenı file-storage token dosyasına yazar"
	@echo "  make token-file-init-v3 : .env içindeki V3 tokenı file-storage token dosyasına yazar"
	@echo "  make cron-install-db-backup : Her gün 12:00 DB backup cron satırını kurar/günceller"
	@echo "  make cron-show     : Mevcut crontab kayıtlarını gösterir"
	@echo "----------------------------------------------------------------------"
	@echo "  make db-all        : V4 oda SQLite tablolarını listeler"
	@echo "  make db-all-v3     : V3 oda SQLite tablolarını listeler"
	@echo "  make db-users      : shared 'users' tablosundaki tüm kayıtları listeler"
	@echo "  make db-user-stats : 'user_stats' tablosundaki tüm istatistikleri listeler"
	@echo "  make db-user-stats-v3 : V3 'user_stats' tablosundaki tüm istatistikleri listeler"
	@echo "  make db-games      : 'games' tablosundaki tüm kayıtları listeler"
	@echo "  make db-games-v3   : V3 'games' tablosundaki tüm kayıtları listeler"
	@echo "  make db-visited_users : shared 'visited_users' tablosundaki tüm kayıtları listeler"
	@echo "  make db-istekler   : 'istekler' tablosundaki tüm kayıtları listeler"
	@echo "  make db-istekler-v3 : V3 'istekler' tablosundaki tüm kayıtları listeler"
	@echo "  make db-blacklist  : shared 'blacklisted_users' tablosundaki kayıtları listeler"
	@echo "  make db-users-today : Bugün görülen users kayıtlarını listeler"
	@echo "  make db-visited_users-today : Bugün gelen visited_users kayıtlarını listeler"
	@echo "  make db-user-with-auth USERNAME='oyuncu' : Oyuncunun auth bilgisini gösterir"
	@echo "----------------------------------------------------------------------"
	@echo "  make db-set-role USERNAME='oyuncu' ROLE='admin' : Kullanıcı rolünü ayarlar"
	@echo "  make db-make-superadmin USERNAME='oyuncu' : Kullanıcı rolünü owner yapar"
	@echo "  make db-make-admin USERNAME='oyuncu' : Kullanıcı rolünü admin yapar"
	@echo "  make db-make-mod USERNAME='oyuncu' : Kullanıcı rolünü mod yapar"
	@echo "  make db-make-vip USERNAME='oyuncu' : Kullanıcı rolünü vip yapar"
	@echo "  make db-make-player USERNAME='oyuncu' : Kullanıcı rolünü player yapar"
	@echo "  make db-blacklist-player USERNAME='oyuncu' REASON='sebep' : Kullanıcıyı kara listeye ekler"
	@echo "  make db-unblacklist-player USERNAME='oyuncu' : Kullanıcıyı kara listeden çıkarır"
	@echo "----------------------------------------------------------------------"
	@echo "  make db-backup     : SQLite veritabanının timestamp'li yedeğini alır"
	@echo "  make db-backup-v3  : Sadece V3 oda SQLite veritabanının yedeğini alır"
	@echo "  make db-backups    : Alınmış veritabanı yedeklerini listeler"
	@echo "  make db-restore BACKUP='$(DB_BACKUP_DIR)/...' : Seçilen yedeği geri yükler"
	@echo "  make db-restore-v3 BACKUP='$(DB_BACKUP_DIR)/...' : Seçilen V3 yedeğini geri yükler"
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

restart:
	docker compose restart haxball

restart-v3:
	docker compose --profile v3 restart haxball-v3

rebuild:
	docker compose up -d --build haxball

rebuild-v3:
	docker compose --profile v3 up -d --build haxball-v3

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

logs-backend-v3:
	docker logs -f $(V3_CONTAINER) | grep --line-buffered "\[BACKEND-DB\]"

logs-chat:
	docker logs -f $(CONTAINER) | grep --line-buffered "\[CHAT\]"

logs-chat-v3:
	docker logs -f $(V3_CONTAINER) | grep --line-buffered "\[CHAT\]"

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

logs-json-errors-v3:
	@LOG_DIR="$(V3_LOG_DIR)" LIMIT="$(LIMIT)" LEVEL="error" node scripts/tools/logQuery.js

logs-json-player:
	@if [ -z "$(USERNAME)" ]; then echo "⚠️ HATA: USERNAME belirtilmedi! Örnek: make logs-json-player USERNAME='Longman'"; exit 1; fi
	@LOG_DIR="$(LOG_DIR)" LIMIT="$(LIMIT)" USERNAME="$(USERNAME)" node scripts/tools/logQuery.js

logs-json-player-v3:
	@if [ -z "$(USERNAME)" ]; then echo "⚠️ HATA: USERNAME belirtilmedi! Örnek: make logs-json-player-v3 USERNAME='Longman'"; exit 1; fi
	@LOG_DIR="$(V3_LOG_DIR)" LIMIT="$(LIMIT)" USERNAME="$(USERNAME)" node scripts/tools/logQuery.js

logs-json-event:
	@if [ -z "$(EVENT)" ]; then echo "⚠️ HATA: EVENT belirtilmedi! Örnek: make logs-json-event EVENT='goal'"; exit 1; fi
	@LOG_DIR="$(LOG_DIR)" LIMIT="$(LIMIT)" EVENT="$(EVENT)" node scripts/tools/logQuery.js

logs-json-event-v3:
	@if [ -z "$(EVENT)" ]; then echo "⚠️ HATA: EVENT belirtilmedi! Örnek: make logs-json-event-v3 EVENT='goal'"; exit 1; fi
	@LOG_DIR="$(V3_LOG_DIR)" LIMIT="$(LIMIT)" EVENT="$(EVENT)" node scripts/tools/logQuery.js

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

token-file-init-v3:
	@set -e; \
	mkdir -p "$(FILE_STORAGE_DIR)"; \
	token=$$(awk -F= '/^HAXBALL_TOKEN_V3=/{print substr($$0, index($$0, "=") + 1)}' .env 2>/dev/null | tail -1 | sed 's/^"//; s/"$$//; s/^'\''//; s/'\''$$//'); \
	if [ -z "$$token" ]; then echo "⚠️ HATA: .env içinde HAXBALL_TOKEN_V3 bulunamadı."; exit 1; fi; \
	printf "%s\n" "$$token" > "$(V3_TOKEN_FILE)"; \
	chmod 600 "$(V3_TOKEN_FILE)"; \
	echo "✅ V3 token dosyası hazırlandı: $(V3_TOKEN_FILE)"

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

db-all-v3:
	docker exec -it $(V3_CONTAINER) node -e "\
		const fs = require('fs'); \
		const initSqlJs = require('sql.js'); \
		initSqlJs().then(SQL => { \
			const db = new SQL.Database(fs.readFileSync('./$(V3_DB_FILE)')); \
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

db-user-stats-v3:
	docker exec -it $(V3_CONTAINER) node -e "\
		const fs = require('fs'); \
		const initSqlJs = require('sql.js'); \
		initSqlJs().then(SQL => { \
			const db = new SQL.Database(fs.readFileSync('./$(V3_DB_FILE)')); \
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

db-games-v3:
	docker exec -it $(V3_CONTAINER) node -e "\
		const fs = require('fs'); \
		const initSqlJs = require('sql.js'); \
		initSqlJs().then(SQL => { \
			const db = new SQL.Database(fs.readFileSync('./$(V3_DB_FILE)')); \
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

db-istekler-v3:
	docker exec -it $(V3_CONTAINER) node -e "\
		const fs = require('fs'); \
		const initSqlJs = require('sql.js'); \
		initSqlJs().then(SQL => { \
			const db = new SQL.Database(fs.readFileSync('./$(V3_DB_FILE)')); \
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

db-set-role:
	@if [ -z "$(USERNAME)" ]; then echo "⚠️ HATA: USERNAME belirtilmedi! Örnek: make db-set-role USERNAME='oyuncu' ROLE='admin'"; exit 1; fi
	@if [ -z "$(ROLE)" ]; then echo "⚠️ HATA: ROLE belirtilmedi! Geçerli roller: player, vip, mod, admin, owner"; exit 1; fi
	docker exec -e TARGET_USERNAME="$(USERNAME)" -e TARGET_ROLE="$(ROLE)" -i $(CONTAINER) node < scripts/tools/dbSetRole.js

db-make-superadmin:
	@$(MAKE) db-set-role USERNAME="$(USERNAME)" ROLE=owner

db-make-admin:
	@$(MAKE) db-set-role USERNAME="$(USERNAME)" ROLE=admin

db-make-mod:
	@$(MAKE) db-set-role USERNAME="$(USERNAME)" ROLE=mod

db-make-vip:
	@$(MAKE) db-set-role USERNAME="$(USERNAME)" ROLE=vip

db-make-player:
	@$(MAKE) db-set-role USERNAME="$(USERNAME)" ROLE=player


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

db-backup-v3:
	@set -e; \
	mkdir -p "$(DB_BACKUP_DIR)"; \
	source="$(V3_DB_FILE)"; \
	if [ ! -f "$$source" ]; then echo "⚠️ HATA: V3 DB bulunamadı: $$source"; exit 1; fi; \
	ts=$$(date +%Y%m%d-%H%M%S); \
	name=$$(basename "$$source" .sqlite); \
	backup="$(DB_BACKUP_DIR)/$$name-$$ts.sqlite"; \
	tmp="$$backup.tmp"; \
	cp -p "$$source" "$$tmp"; \
	node -e 'const fs = require("fs"); const initSqlJs = require("sql.js"); const file = process.argv[1]; initSqlJs().then(SQL => { const db = new SQL.Database(fs.readFileSync(file)); db.exec("SELECT name FROM sqlite_master LIMIT 1"); db.close(); }).catch((err) => { console.error("⚠️ Backup doğrulaması başarısız:", err.message); process.exit(1); });' "$$tmp"; \
	mv "$$tmp" "$$backup"; \
	echo "✅ V3 DB backup alındı: $$backup"

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

db-restore-v3:
	@if [ -z "$(BACKUP)" ]; then echo "⚠️ HATA: BACKUP belirtilmedi! Örnek: make db-restore-v3 BACKUP='$(DB_BACKUP_DIR)/haxball-v3-results-YYYYMMDD-HHMMSS.sqlite'"; exit 1; fi
	@if [ ! -f "$(BACKUP)" ]; then echo "⚠️ HATA: Backup bulunamadı: $(BACKUP)"; exit 1; fi
	@if docker inspect -f '{{.State.Running}}' $(V3_CONTAINER) 2>/dev/null | grep -q true; then echo "⚠️ HATA: V3 container çalışırken restore yapılmadı. Önce V3 odasını bilinçli şekilde durdur."; exit 1; fi
	@node -e 'const fs = require("fs"); const initSqlJs = require("sql.js"); const file = process.argv[1]; initSqlJs().then(SQL => { const db = new SQL.Database(fs.readFileSync(file)); db.exec("SELECT name FROM sqlite_master LIMIT 1"); db.close(); }).catch((err) => { console.error("⚠️ Backup doğrulaması başarısız:", err.message); process.exit(1); });' "$(BACKUP)"
	@mkdir -p "$(dir $(V3_DB_FILE))"
	@cp -p "$(BACKUP)" "$(V3_DB_FILE)"
	@echo "✅ V3 DB restore edildi: $(BACKUP) -> $(V3_DB_FILE)"
