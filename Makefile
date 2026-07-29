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

db-drop-users:
	docker exec -it $(CONTAINER) node -e "const fs = require('fs'); const initSqlJs = require('sql.js'); initSqlJs().then(SQL => { const db = new SQL.Database(fs.readFileSync('./db/haxball-results.sqlite')); db.run('DROP TABLE IF EXISTS users;'); fs.writeFileSync('./db/haxball-results.sqlite', Buffer.from(db.export())); console.log('Users tablosu tamamen silindi!'); });"