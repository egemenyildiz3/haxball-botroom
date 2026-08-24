const { sendMsg } = require('./helpers');
const { getOrCreatePlayerUid } = require('../db');
const { hasCapability, normalizeRole } = require('../roles');

function fallbackT(key, vars = {}) {
  const messages = {
    'common.dbError': '❌ Veritabanı hatası oluştu. Lütfen Kurucuya bildirin.',
    'account.autoLogin': `🟢 Otomatik giriş yapıldı! Hoş geldin, ${vars.name}.`,
    'account.registeredDetected': '🟡 Kayıtlı hesap tespit edildi. Giriş yapmak için: !giriş / !giris <şifre>',
    'account.welcomeUnregistered': `ℹ️ Odaya hoş geldiniz ${vars.name}! Kayıt olmak için: !kaydol <şifre>`,
    'account.statsLoginRequired': '⚠️ İstatistiklerinizi görmek için önce giriş yapmalısınız! (!kaydol <şifre> veya !giris <şifre>)',
    'account.statsMissing': '❌ İstatistikleriniz bulunamadı.',
    'account.statsError': '❌ İstatistikler yüklenirken bir hata oluştu.',
    'account.statsLine': `📊 [${vars.name}] İstatistikler | ⚽ Gol: ${vars.goals} | 🅰️ Asist: ${vars.assists} | 🏆 Galibiyet: ${vars.wins} | ❌ Mağlubiyet: ${vars.losses} | 📈 Win %: %${vars.winRate}`,
    'leaderboard.empty': `📊 ${vars.text}`,
    'leaderboard.error': '❌ Liderlik tablosu yüklenirken bir hata oluştu.',
    'leaderboard.goals.title': '⚽ Gol kralı',
    'leaderboard.goals.empty': 'Henüz gol istatistiği yok.',
    'leaderboard.assists.title': '🅰️ Asist kralı',
    'leaderboard.assists.empty': 'Henüz asist istatistiği yok.',
    'leaderboard.wins.title': '🏆 En çok maç kazananlar',
    'leaderboard.wins.empty': 'Henüz galibiyet istatistiği yok.',
    'account.alreadySession': '🟢 Zaten oturum açmış durumdasınız!',
    'account.registerUsage': '❌ Kullanım: !kaydol <şifre>',
    'account.usernameTaken': '⚠️ Bu kullanıcı adı zaten kayıtlı. Giriş yapmak için: !giriş / !giris <şifre>',
    'account.registerSuccess': '🎉 Hesabınız oluşturuldu ve giriş yapıldı!',
    'account.registerError': '❌ Hesap kaydedilirken bir hata oluştu.',
    'account.alreadyLoggedIn': '🟢 Zaten giriş yapmış durumdasınız!',
    'account.loginUsage': '❌ Kullanım: !giriş / !giris <şifre>',
    'account.loginSuccess': `🔓 Giriş başarılı! Hoş geldin, ${vars.name}.`,
    'account.badPassword': '❌ Hatalı şifre.',
    'account.notFound': '⚠️ Hesap bulunamadı. Kayıt olmak için: !kaydol <şifre>',
    'account.loginError': '❌ Giriş yapılırken veritabanı hatası oluştu.',
  };
  return messages[key] || key;
}

function applyNativeAdmin(room, player, userData, roleCapabilities) {
  if (
    player
    && typeof room.setPlayerAdmin === 'function'
    && hasCapability(userData, 'native_admin', roleCapabilities)
  ) {
    room.setPlayerAdmin(player.id, true);
    return true;
  }
  return false;
}

function handleAutoLogin(room, player, { db, DB_FILE, loggedInPlayers, persistDatabase, config, t = fallbackT }) {
  if (!player || typeof player.id === 'undefined') return;

  const cleanedName = player.name ? player.name.replace(/^\[\d{3}\]\s*/, '').trim() : '';
  const playerToken = player.auth || player.conn || '';

  console.log(`[BACKEND-DB] AutoLogin sorgusu başlatıldı -> Kullanıcı: "${cleanedName}" | Token: "${playerToken || 'YOK'}"`);

  try {
    const stmt = db.prepare('SELECT username, password, auth_key, role, player_uid FROM users WHERE username = ?');
    stmt.bind([cleanedName]);

    if (stmt.step()) {
      const row = stmt.getAsObject();
      const dbAuth = row.auth_key || '';

      if ((playerToken && dbAuth && playerToken === dbAuth) || dbAuth === '' || !dbAuth) {
        const playerUid = row.player_uid || getOrCreatePlayerUid(db, cleanedName, playerToken);
        const role = normalizeRole(row.role);
        const userData = { username: cleanedName, role, player_uid: playerUid };
        loggedInPlayers.set(player.id, userData);

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

        if (applyNativeAdmin(room, player, userData, config && config.adminRules && config.adminRules.roleCapabilities)) {
          console.log(`[BACKEND-DB] Native admin yetkisi atandı -> Kullanıcı: "${cleanedName}" | Role: ${role}`);
        }

        sendMsg(room, t('account.autoLogin', { name: cleanedName }), player.id, 0x00FF7F, 'bold');
      } else {
        console.log(`[BACKEND-DB] Token eşleşmedi (Sadece şifre ile giriş yapabilir) -> Kullanıcı: "${cleanedName}"`);
        sendMsg(room, t('account.registeredDetected'), player.id, 0xFFCC00, 'normal');
      }
    } else {
      console.log(`[BACKEND-DB] Kayıtsız kullanıcı tespit edildi -> Kullanıcı: "${cleanedName}"`);
      sendMsg(room, t('account.welcomeUnregistered', { name: cleanedName }), player.id, 0x00BFFF, 'normal');
    }
    stmt.free();
  } catch (err) {
    console.warn('[BACKEND-DB] Veritabanı hatası (AutoLogin):', err.message);
    sendMsg(room, t('common.dbError'), player.id, 0xFF5555, 'bold');
  }
}

function handleStats(ctx) {
  const { room, player, cleanedName, loggedInPlayers, db } = ctx;
  const t = ctx.t || fallbackT;
  const userData = loggedInPlayers.get(player.id);
  if (!userData) {
    sendMsg(room, t('account.statsLoginRequired'), player.id, 0xFFCC00, 'bold');
    return false;
  }

  try {
    const stmt = db.prepare(`
      SELECT goals, assists, wins, losses
      FROM user_stats
      WHERE player_uid = ? OR LOWER(TRIM(username)) = LOWER(TRIM(?))
      LIMIT 1
    `.replace(/\s+/g, ' '));
    stmt.bind([userData.player_uid || '', cleanedName]);

    let row = { goals: 0, assists: 0, wins: 0, losses: 0 };
    if (stmt.step()) {
      row = stmt.getAsObject();
    }
    stmt.free();

    const goals = row.goals || 0;
    const assists = row.assists || 0;
    const wins = row.wins || 0;
    const losses = row.losses || 0;
    const totalGames = wins + losses;
    const winRate = totalGames > 0 ? ((wins / totalGames) * 100).toFixed(1) : '0.0';

    sendMsg(
      room,
      t('account.statsLine', { name: cleanedName, goals, assists, wins, losses, winRate }),
      player.id,
      0x00BFFF,
      'bold'
    );
  } catch (err) {
    console.warn('[BACKEND-DB] Stats sorgu hatası:', err.message);
    sendMsg(room, t('account.statsError'), player.id, 0xFF5555, 'bold');
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
  const t = ctx.t || fallbackT;
  const leaderboard = LEADERBOARDS[type];
  if (!leaderboard) return false;

  try {
    const stmt = db.prepare(`
      SELECT username, ${leaderboard.column} AS value
      FROM user_stats
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
      sendMsg(room, t('leaderboard.empty', { text: t(`leaderboard.${type}.empty`) }), player.id, 0xFFCC00, 'bold');
      return false;
    }

    const lines = rows.map((row, index) => `${index + 1}. ${row.username} — ${row.value}`);
    sendMsg(room, `${t(`leaderboard.${type}.title`)}\n${lines.join('\n')}`, null, 0xFFD700, 'bold');
  } catch (err) {
    console.warn('[BACKEND-DB] Liderlik tablosu sorgu hatası:', err.message);
    sendMsg(room, t('leaderboard.error'), player.id, 0xFF5555, 'bold');
  }

  return false;
}

function handleRegister(ctx) {
  const { room, player, args, cleanedName, playerToken, loggedInPlayers, db, DB_FILE, persistDatabase } = ctx;
  const t = ctx.t || fallbackT;
  if (loggedInPlayers.has(player.id)) {
    sendMsg(room, t('account.alreadySession'), player.id, 0x00FF7F, 'bold');
    return false;
  }

  const password = args[1];
  if (!password) {
    sendMsg(room, t('account.registerUsage'), player.id, 0xFF5555, 'bold');
    return false;
  }

  try {
    console.log(`[BACKEND-DB] Kullanıcı kayıt kontrolü yapılıyor -> Kullanıcı: "${cleanedName}"`);
    const stmt = db.prepare('SELECT username FROM users WHERE username = ?');
    stmt.bind([cleanedName]);

    if (stmt.step()) {
      console.log(`[BACKEND-DB] Kayıt engellendi (Kullanıcı zaten mevcut) -> "${cleanedName}"`);
      sendMsg(room, t('account.usernameTaken'), player.id, 0xFFCC00, 'bold');
      stmt.free();
    } else {
      stmt.free();
      const playerUid = getOrCreatePlayerUid(db, cleanedName, playerToken);
      console.log(`[BACKEND-DB] Yeni kullanıcı ekleniyor -> Kullanıcı: "${cleanedName}" | Token: "${playerToken}"`);

      db.run(
        'INSERT INTO users (username, player_uid, password, auth_key, role, registered_at) VALUES (?, ?, ?, ?, ?, ?)',
        [cleanedName, playerUid, password, playerToken, 'player', new Date().toISOString()]
      );
      db.run(
        'INSERT OR IGNORE INTO user_stats (player_uid, username, goals, assists, wins, losses, updated_at) VALUES (?, ?, 0, 0, 0, 0, ?)',
        [playerUid, cleanedName, new Date().toISOString()]
      );

      persistDatabase(db, DB_FILE);
      loggedInPlayers.set(player.id, { username: cleanedName, role: 'player', player_uid: playerUid });

      console.log(`[BACKEND-DB] Yeni kullanıcı başarıyla kaydedildi ve dosyaya yazıldı -> "${cleanedName}"`);
      sendMsg(room, t('account.registerSuccess'), player.id, 0x00FF7F, 'bold');
    }
  } catch (err) {
    console.warn('[BACKEND-DB] Kayıt hatası:', err.message);
    sendMsg(room, t('account.registerError'), player.id, 0xFF5555, 'bold');
  }
  return false;
}

function handleLogin(ctx) {
  const { room, player, args, cleanedName, playerToken, loggedInPlayers, db, DB_FILE, persistDatabase, config } = ctx;
  const t = ctx.t || fallbackT;
  if (loggedInPlayers.has(player.id)) {
    sendMsg(room, t('account.alreadyLoggedIn'), player.id, 0x00FF7F, 'bold');
    return false;
  }

  const password = args[1];
  if (!password) {
    sendMsg(room, t('account.loginUsage'), player.id, 0xFF5555, 'bold');
    return false;
  }

  try {
    console.log(`[BACKEND-DB] Manuel giriş kontrolü -> Kullanıcı: "${cleanedName}"`);
    const stmt = db.prepare('SELECT password, role, player_uid FROM users WHERE username = ?');
    stmt.bind([cleanedName]);

    if (stmt.step()) {
      const row = stmt.getAsObject();
      if (row.password === password) {
        const playerUid = row.player_uid || getOrCreatePlayerUid(db, cleanedName, playerToken);
        console.log(`[BACKEND-DB] Şifre doğru. Auth key güncelleniyor -> "${cleanedName}"`);
        db.run('UPDATE users SET auth_key = ?, player_uid = COALESCE(NULLIF(player_uid, \'\'), ?) WHERE username = ?', [playerToken || null, playerUid, cleanedName]);
        persistDatabase(db, DB_FILE);

        const role = normalizeRole(row.role);
        const userData = { username: cleanedName, role, player_uid: playerUid };
        loggedInPlayers.set(player.id, userData);

        if (applyNativeAdmin(room, player, userData, config && config.adminRules && config.adminRules.roleCapabilities)) {
          console.log(`[BACKEND-DB] Native admin yetkisi aktifleştirildi -> "${cleanedName}" | Role: ${role}`);
        }

        console.log(`[BACKEND-DB] Manuel giriş başarılı -> "${cleanedName}"`);
        sendMsg(room, t('account.loginSuccess', { name: cleanedName }), player.id, 0x00FF7F, 'bold');
      } else {
        console.log(`[BACKEND-DB] Manuel giriş başarısız (Hatalı Şifre) -> "${cleanedName}"`);
        sendMsg(room, t('account.badPassword'), player.id, 0xFF5555, 'bold');
      }
    } else {
      console.log(`[BACKEND-DB] Manuel giriş başarısız (Kullanıcı Bulunamadı) -> "${cleanedName}"`);
      sendMsg(room, t('account.notFound'), player.id, 0xFFCC00, 'bold');
    }
    stmt.free();
  } catch (err) {
    console.warn('[BACKEND-DB] Giriş hatası:', err.message);
    sendMsg(room, t('account.loginError'), player.id, 0xFF5555, 'bold');
  }
  return false;
}

function routeAccountCommand(ctx) {
  if (ctx.commandKey === 'stats') return handleStats(ctx);
  if (ctx.commandKey === 'goals') return handleLeaderboard(ctx, 'goals');
  if (ctx.commandKey === 'assists') return handleLeaderboard(ctx, 'assists');
  if (ctx.commandKey === 'wins') return handleLeaderboard(ctx, 'wins');
  if (ctx.commandKey === 'signup') return handleRegister(ctx);
  if (ctx.commandKey === 'login') return handleLogin(ctx);
  return null;
}

module.exports = {
  handleAutoLogin,
  routeAccountCommand,
};
