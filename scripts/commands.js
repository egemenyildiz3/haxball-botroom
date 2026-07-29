const { normalizeCmd } = require('./util');

function sendMsg(room, text, targetId, color = 0x00FF7F, style = 'bold') {
  try {
    room.sendAnnouncement(text, targetId, color, style, 1);
  } catch (err) {
    console.warn('sendAnnouncement hatası:', err.message);
  }
}

function checkDuplicateLogin(room, player, { loggedInPlayers }) {
  const playerToken = player.auth || player.conn || '';
  if (!playerToken) return false;
  if (typeof room.getPlayerList !== 'function') return false;

  const currentPlayers = room.getPlayerList();
  for (const p of currentPlayers) {
    const pToken = p.auth || p.conn || '';
    if (p.id !== player.id && pToken && pToken === playerToken) {
      if (typeof room.kickPlayer === 'function') {
        room.kickPlayer(player.id, 'Başka bir sekmede zaten bu odadasınız!', false);
        return true;
      }
    }
  }
  return false;
}

function handleAutoLogin(room, player, { db, DB_FILE, loggedInPlayers, persistDatabase }) {
  if (!player || typeof player.id === 'undefined') return;

  const cleanedName = player.name ? player.name.replace(/^\[\d{3}\]\s*/, '').trim() : '';
  const playerToken = player.auth || player.conn || '';

  console.log(`[BACKEND-DB] AutoLogin sorgusu başlatıldı -> Kullanıcı: "${cleanedName}" | Token: "${playerToken || 'YOK'}"`);

  try {
    const stmt = db.prepare('SELECT username, password, auth_key, isadmin FROM users WHERE username = ?');
    stmt.bind([cleanedName]);

    if (stmt.step()) {
      const row = stmt.getAsObject();
      const dbAuth = row.auth_key || '';

      if ((playerToken && dbAuth && playerToken === dbAuth) || dbAuth === '' || !dbAuth) {
        loggedInPlayers.add(player.id);

        if (playerToken && playerToken !== dbAuth) {
          console.log(`[BACKEND-DB] Auth Key güncellemesi yapılıyor -> Kullanıcı: "${cleanedName}" | Yeni Token: "${playerToken}"`);
          db.run('UPDATE users SET auth_key = ? WHERE username = ?', [playerToken, cleanedName]);
          persistDatabase(db, DB_FILE);
          console.log(`[BACKEND-DB] Auth Key veritabanına başarıyla işlendi -> "${cleanedName}"`);
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
    sendMsg(room, `❌ Veritabanı hatası oluştu. Lütfen yöneticiye bildirin.`, player.id, 0xFF5555, 'bold');
  }
}

function handlePlayerChat(room, player, msg, { db, DB_FILE, loggedInPlayers, playerAssignments, persistDatabase, ADMIN_PASSWORD, afkPlayers, rebalanceTeams }) {
  const text = String(msg || '').trim();
  
  const displayName = playerAssignments.get(player.id) || (player.name ? player.name.replace(/^\[\d{3}\]\s*/, '').trim() : '');
  const cleanedName = (player.name || '').replace(/^\[\d{3}\]\s*/, '').trim();

  const args = text.split(' ');
  const command = normalizeCmd(args[0] || '');  
  const playerToken = player.auth || player.conn || '';

  console.log(`[CHAT] ${displayName} (Token: ${playerToken || 'YOK'}): ${text}`);

  if (!text.startsWith('!')) {
    sendMsg(room, `💬 ${displayName}: ${text}`, null, 0xFFFFFF, 'normal');
    return false;
  }

  if (command === '!afk') {
    if (afkPlayers.has(player.id)) {
      afkPlayers.delete(player.id);
      sendMsg(room, `🔔 ${displayName} artık AFK değil! Oyuna girmeye hazır.`, null, 0x00FF7F, 'bold');
    } else {
      afkPlayers.add(player.id);
      if (player.team !== 0 && typeof room.setPlayerTeam === 'function') {
        try { room.setPlayerTeam(player.id, 0); } catch (e) {}
      }
      sendMsg(room, `💤 ${displayName} AFK moduna geçti.`, null, 0xFFCC00, 'bold');
    }

    if (typeof rebalanceTeams === 'function') {
      rebalanceTeams();
    }
  } else if (command === '!s' || command === '!stats' || command === '!istatistik') {
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
  } else if (command === '!kaydol' || command === '!kayit') {
    if (loggedInPlayers.has(player.id)) {
      sendMsg(room, '🟢 Zaten oturum açmış durumdasınız!', player.id, 0x00FF7F, 'bold');
      return false;
    }

    const password = args[1];
    if (!password) {
      sendMsg(room, '❌ Kullanım: !kaydol <şifre>', player.id, 0xFF5555, 'bold');
    } else {
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
          console.log(`[BACKEND-DB] Yeni kullanıcı ekleniyor -> Kullanıcı: "${cleanedName}" | Token: "${playerToken}"`);
          
          db.run(
            'INSERT INTO users (username, password, auth_key, registered_at, last_ip, isadmin, goals, assists, wins, losses) VALUES (?, ?, ?, ?, ?, 0, 0, 0, 0, 0)',
            [cleanedName, password, playerToken, new Date().toISOString(), playerIp]
          );
          
          persistDatabase(db, DB_FILE);
          loggedInPlayers.add(player.id);
          
          console.log(`[BACKEND-DB] Yeni kullanıcı başarıyla kaydedildi ve dosyaya yazıldı -> "${cleanedName}"`);
          sendMsg(room, `🎉 Hesabınız oluşturuldu ve giriş yapıldı!`, player.id, 0x00FF7F, 'bold');
        }
      } catch (err) {
        console.warn('[BACKEND-DB] Kayıt hatası:', err.message);
        sendMsg(room, '❌ Hesap kaydedilirken bir hata oluştu.', player.id, 0xFF5555, 'bold');
      }
    }
  } else if (command === '!giris') {
    if (loggedInPlayers.has(player.id)) {
      sendMsg(room, '🟢 Zaten giriş yapmış durumdasınız!', player.id, 0x00FF7F, 'bold');
      return false;
    }

    const password = args[1];
    if (!password) {
      sendMsg(room, '❌ Kullanım: !giriş / !giris <şifre>', player.id, 0xFF5555, 'bold');
    } else {
      try {
        console.log(`[BACKEND-DB] Manuel giriş kontrolü -> Kullanıcı: "${cleanedName}"`);
        const stmt = db.prepare('SELECT password, isadmin FROM users WHERE username = ?');
        stmt.bind([cleanedName]);

        if (stmt.step()) {
          const row = stmt.getAsObject();
          if (row.password === password) {
            console.log(`[BACKEND-DB] Şifre doğru. Auth key güncelleniyor -> "${cleanedName}"`);
            db.run('UPDATE users SET auth_key = ? WHERE username = ?', [playerToken || null, cleanedName]);
            persistDatabase(db, DB_FILE);

            loggedInPlayers.add(player.id);

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
    }
  } else if (ADMIN_PASSWORD && text === `!admin ${ADMIN_PASSWORD}`) {
    if (typeof room.setPlayerAdmin === 'function') {
      room.setPlayerAdmin(player.id, true);
      sendMsg(room, '👑 Yönetici yetkisi verildi.', player.id, 0xFFD700, 'bold');
    }
  } else if (command === '!kick') {
    if (!player.admin) {
      sendMsg(room, '❌ Bu komutu kullanmak için yönetici olmalısın.', player.id, 0xFF5555, 'bold');
      return false;
    }

    const targetId = Number(args[1]);
    const reason = args.slice(2).join(' ') || 'Yönetici tarafından atıldınız.';

    if (Number.isNaN(targetId)) {
      sendMsg(room, '❌ Kullanım: !kick <oyuncu_id> [sebep]', player.id, 0xFF5555, 'bold');
      return false;
    }

    try {
      room.kickPlayer(targetId, reason, false);
      sendMsg(room, `👢 ID: ${targetId} olan oyuncu odadan atıldı.`, player.id, 0x00FF7F, 'bold');
    } catch (err) {
      sendMsg(room, `❌ Oyuncu atılamadı: ${err.message}`, player.id, 0xFF5555, 'bold');
    }
  } else if (command === '!yardim' || command === '!yardım' || command === '!help') {
      const helpText = [
        '📖 Spacebounce 4v4 - Komut listesi:',
        '• !s / !stats / !istatistik — İstatistiklerinizi gösterir',
        '• !afk — AFK modunu açar/kapatır',
        '• !kaydol <şifre> — Hesap oluşturur ve oturum açar',
        '• !giris <şifre> — Mevcut hesabınıza giriş yapar',
      ].join('\n');
      sendMsg(room, helpText, player.id, 0x00BFFF, 'normal');
  } else {
    sendMsg(room, '❌ Hatalı komut! Yardım için !yardım yazabilirsiniz.', player.id, 0xFF5555, 'bold');
  }

  return false;
}

module.exports = {
  sendMsg,
  checkDuplicateLogin,
  handleAutoLogin,
  handlePlayerChat,
};