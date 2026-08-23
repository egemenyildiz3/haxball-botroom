const { sendMsg } = require('./helpers');
const { getOrCreatePlayerUid } = require('../db');

function handleAutoLogin(room, player, { db, DB_FILE, loggedInPlayers, persistDatabase }) {
  if (!player || typeof player.id === 'undefined') return;

  const cleanedName = player.name ? player.name.replace(/^\[\d{3}\]\s*/, '').trim() : '';
  const playerToken = player.auth || player.conn || '';

  console.log(`[BACKEND-DB] AutoLogin sorgusu başlatıldı -> Kullanıcı: "${cleanedName}" | Token: "${playerToken || 'YOK'}"`);

  try {
    const stmt = db.prepare('SELECT username, password, auth_key, isadmin, player_uid FROM users WHERE username = ?');
    stmt.bind([cleanedName]);

    if (stmt.step()) {
      const row = stmt.getAsObject();
      const dbAuth = row.auth_key || '';

      if ((playerToken && dbAuth && playerToken === dbAuth) || dbAuth === '' || !dbAuth) {
        const playerUid = row.player_uid || getOrCreatePlayerUid(db, cleanedName, playerToken);
        loggedInPlayers.set(player.id, { username: cleanedName, isadmin: row.isadmin, player_uid: playerUid });

        if (playerToken && playerToken !== dbAuth) {
          console.log(`[BACKEND-DB] Auth Key güncellemesi yapılıyor -> Kullanıcı: "${cleanedName}" | Yeni Token: "${playerToken}"`);
          db.run('UPDATE users SET auth_key = ?, player_uid = COALESCE(NULLIF(player_uid, \'\'), ?) WHERE username = ?', [playerToken, playerUid, cleanedName]);
          persistDatabase(db, DB_FILE);
          console.log(`[BACKEND-DB] Auth Key veritabanına başarıyla işlendi -> "${cleanedName}"`);
        } else if (!row.player_uid) {
          db.run('UPDATE users SET player_uid = ? WHERE username = ?', [playerUid, cleanedName]);
          persistDatabase(db, DB_FILE);
          console.log(`[BACKEND-DB] Player UID veritabanına başarıyla işlendi -> "${cleanedName}" | UID: ${playerUid}`);
        } else {
          console.log(`[BACKEND-DB] Otomatik giriş doğrulandı -> Kullanıcı: "${cleanedName}"`);
        }

        if (row.isadmin === 1 && typeof room.setPlayerAdmin === 'function') {
          room.setPlayerAdmin(player.id, true);
          console.log(`[BACKEND-DB] Admin yetkisi atandı -> Kullanıcı: "${cleanedName}"`);
        }

        sendMsg(room, `🟢 Otomatik giriş yapıldı! Hoş geldin, ${cleanedName}.`, player.id, 0x00FF7F, 'bold');
      } else {
        console.log(`[BACKEND-DB] Token eşleşmedi (Sadece şifre ile giriş yapabilir) -> Kullanıcı: "${cleanedName}"`);
        sendMsg(room, `🟡 Kayıtlı hesap tespit edildi. Giriş yapmak için: !giriş / !giris <şifre>`, player.id, 0xFFCC00, 'normal');
      }
    } else {
      console.log(`[BACKEND-DB] Kayıtsız kullanıcı tespit edildi -> Kullanıcı: "${cleanedName}"`);
      sendMsg(room, `ℹ️ Odaya hoş geldiniz ${cleanedName}! Kayıt olmak için: !kaydol <şifre>`, player.id, 0x00BFFF, 'normal');
    }
    stmt.free();
  } catch (err) {
    console.warn('[BACKEND-DB] Veritabanı hatası (AutoLogin):', err.message);
    sendMsg(room, `❌ Veritabanı hatası oluştu. Lütfen Kurucuya bildirin.`, player.id, 0xFF5555, 'bold');
  }
}

function handleStats(ctx) {
  const { room, player, cleanedName, loggedInPlayers, db } = ctx;
  if (!loggedInPlayers.has(player.id)) {
    sendMsg(room, '⚠️ İstatistiklerinizi görmek için önce giriş yapmalısınız! (!kaydol <şifre> veya !giris <şifre>)', player.id, 0xFFCC00, 'bold');
    return false;
  }

  try {
    const stmt = db.prepare('SELECT goals, assists, wins, losses FROM users WHERE username = ?');
    stmt.bind([cleanedName]);

    if (stmt.step()) {
      const row = stmt.getAsObject();
      const goals = row.goals || 0;
      const assists = row.assists || 0;
      const wins = row.wins || 0;
      const losses = row.losses || 0;
      const totalGames = wins + losses;
      const winRate = totalGames > 0 ? ((wins / totalGames) * 100).toFixed(1) : '0.0';

      sendMsg(
        room,
        `📊 [${cleanedName}] İstatistikler | ⚽ Gol: ${goals} | 🅰️ Asist: ${assists} | 🏆 Galibiyet: ${wins} | ❌ Mağlubiyet: ${losses} | 📈 Win %: %${winRate}`,
        player.id,
        0x00BFFF,
        'bold'
      );
    } else {
      sendMsg(room, '❌ İstatistikleriniz bulunamadı.', player.id, 0xFF5555, 'bold');
    }
    stmt.free();
  } catch (err) {
    console.warn('[BACKEND-DB] Stats sorgu hatası:', err.message);
    sendMsg(room, '❌ İstatistikler yüklenirken bir hata oluştu.', player.id, 0xFF5555, 'bold');
  }
  return false;
}

const LEADERBOARDS = {
  goals: {
    column: 'goals',
    title: '⚽ Gol kralı',
    empty: 'Henüz gol istatistiği yok.',
  },
  assists: {
    column: 'assists',
    title: '🅰️ Asist kralı',
    empty: 'Henüz asist istatistiği yok.',
  },
  wins: {
    column: 'wins',
    title: '🏆 En çok maç kazananlar',
    empty: 'Henüz galibiyet istatistiği yok.',
  },
};

function handleLeaderboard(ctx, type) {
  const { room, player, db } = ctx;
  const leaderboard = LEADERBOARDS[type];
  if (!leaderboard) return false;

  try {
    const stmt = db.prepare(`
      SELECT username, ${leaderboard.column} AS value
      FROM users
      WHERE COALESCE(${leaderboard.column}, 0) > 0
      ORDER BY ${leaderboard.column} DESC, username COLLATE NOCASE ASC
      LIMIT 5
    `.replace(/\s+/g, ' '));

    const rows = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject());
    }
    stmt.free();

    if (rows.length === 0) {
      sendMsg(room, `📊 ${leaderboard.empty}`, player.id, 0xFFCC00, 'bold');
      return false;
    }

    const lines = rows.map((row, index) => `${index + 1}. ${row.username} — ${row.value}`);
    sendMsg(room, `${leaderboard.title}\n${lines.join('\n')}`, null, 0xFFD700, 'bold');
  } catch (err) {
    console.warn('[BACKEND-DB] Liderlik tablosu sorgu hatası:', err.message);
    sendMsg(room, '❌ Liderlik tablosu yüklenirken bir hata oluştu.', player.id, 0xFF5555, 'bold');
  }

  return false;
}

function handleRegister(ctx) {
  const { room, player, args, cleanedName, playerToken, loggedInPlayers, db, DB_FILE, persistDatabase } = ctx;
  if (loggedInPlayers.has(player.id)) {
    sendMsg(room, '🟢 Zaten oturum açmış durumdasınız!', player.id, 0x00FF7F, 'bold');
    return false;
  }

  const password = args[1];
  if (!password) {
    sendMsg(room, '❌ Kullanım: !kaydol <şifre>', player.id, 0xFF5555, 'bold');
    return false;
  }

  try {
    console.log(`[BACKEND-DB] Kullanıcı kayıt kontrolü yapılıyor -> Kullanıcı: "${cleanedName}"`);
    const stmt = db.prepare('SELECT username FROM users WHERE username = ?');
    stmt.bind([cleanedName]);

    if (stmt.step()) {
      console.log(`[BACKEND-DB] Kayıt engellendi (Kullanıcı zaten mevcut) -> "${cleanedName}"`);
      sendMsg(room, '⚠️ Bu kullanıcı adı zaten kayıtlı. Giriş yapmak için: !giriş / !giris <şifre>', player.id, 0xFFCC00, 'bold');
      stmt.free();
    } else {
      stmt.free();
      const playerIp = player.ip || '';
      const playerUid = getOrCreatePlayerUid(db, cleanedName, playerToken);
      console.log(`[BACKEND-DB] Yeni kullanıcı ekleniyor -> Kullanıcı: "${cleanedName}" | Token: "${playerToken}"`);

      db.run(
        'INSERT INTO users (username, player_uid, password, auth_key, isadmin, registered_at, last_ip, goals, assists, wins, losses) VALUES (?, ?, ?, ?, 0, ?, ?, 0, 0, 0, 0)',
        [cleanedName, playerUid, password, playerToken, new Date().toISOString(), playerIp]
      );

      persistDatabase(db, DB_FILE);
      loggedInPlayers.set(player.id, { username: cleanedName, isadmin: 0, player_uid: playerUid });

      console.log(`[BACKEND-DB] Yeni kullanıcı başarıyla kaydedildi ve dosyaya yazıldı -> "${cleanedName}"`);
      sendMsg(room, `🎉 Hesabınız oluşturuldu ve giriş yapıldı!`, player.id, 0x00FF7F, 'bold');
    }
  } catch (err) {
    console.warn('[BACKEND-DB] Kayıt hatası:', err.message);
    sendMsg(room, '❌ Hesap kaydedilirken bir hata oluştu.', player.id, 0xFF5555, 'bold');
  }
  return false;
}

function handleLogin(ctx) {
  const { room, player, args, cleanedName, playerToken, loggedInPlayers, db, DB_FILE, persistDatabase } = ctx;
  if (loggedInPlayers.has(player.id)) {
    sendMsg(room, '🟢 Zaten giriş yapmış durumdasınız!', player.id, 0x00FF7F, 'bold');
    return false;
  }

  const password = args[1];
  if (!password) {
    sendMsg(room, '❌ Kullanım: !giriş / !giris <şifre>', player.id, 0xFF5555, 'bold');
    return false;
  }

  try {
    console.log(`[BACKEND-DB] Manuel giriş kontrolü -> Kullanıcı: "${cleanedName}"`);
    const stmt = db.prepare('SELECT password, isadmin, player_uid FROM users WHERE username = ?');
    stmt.bind([cleanedName]);

    if (stmt.step()) {
      const row = stmt.getAsObject();
      if (row.password === password) {
        const playerUid = row.player_uid || getOrCreatePlayerUid(db, cleanedName, playerToken);
        console.log(`[BACKEND-DB] Şifre doğru. Auth key güncelleniyor -> "${cleanedName}"`);
        db.run('UPDATE users SET auth_key = ?, player_uid = COALESCE(NULLIF(player_uid, \'\'), ?) WHERE username = ?', [playerToken || null, playerUid, cleanedName]);
        persistDatabase(db, DB_FILE);

        loggedInPlayers.set(player.id, { username: cleanedName, isadmin: row.isadmin, player_uid: playerUid });

        if (row.isadmin === 1 && typeof room.setPlayerAdmin === 'function') {
          room.setPlayerAdmin(player.id, true);
          console.log(`[BACKEND-DB] Admin yetkisi aktifleştirildi -> "${cleanedName}"`);
        }

        console.log(`[BACKEND-DB] Manuel giriş başarılı -> "${cleanedName}"`);
        sendMsg(room, `🔓 Giriş başarılı! Hoş geldin, ${cleanedName}.`, player.id, 0x00FF7F, 'bold');
      } else {
        console.log(`[BACKEND-DB] Manuel giriş başarısız (Hatalı Şifre) -> "${cleanedName}"`);
        sendMsg(room, '❌ Hatalı şifre.', player.id, 0xFF5555, 'bold');
      }
    } else {
      console.log(`[BACKEND-DB] Manuel giriş başarısız (Kullanıcı Bulunamadı) -> "${cleanedName}"`);
      sendMsg(room, '⚠️ Hesap bulunamadı. Kayıt olmak için: !kaydol <şifre>', player.id, 0xFFCC00, 'bold');
    }
    stmt.free();
  } catch (err) {
    console.warn('[BACKEND-DB] Giriş hatası:', err.message);
    sendMsg(room, '❌ Giriş yapılırken veritabanı hatası oluştu.', player.id, 0xFF5555, 'bold');
  }
  return false;
}

function routeAccountCommand(ctx) {
  if (ctx.command === '!s' || ctx.command === '!stats' || ctx.command === '!istatistik') return handleStats(ctx);
  if (ctx.command === '!golkrali') return handleLeaderboard(ctx, 'goals');
  if (ctx.command === '!asistkrali') return handleLeaderboard(ctx, 'assists');
  if (ctx.command === '!top') return handleLeaderboard(ctx, 'wins');
  if (ctx.command === '!kaydol' || ctx.command === '!kayit') return handleRegister(ctx);
  if (ctx.command === '!giris') return handleLogin(ctx);
  return null;
}

module.exports = {
  handleAutoLogin,
  routeAccountCommand,
};
