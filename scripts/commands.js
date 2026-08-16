const { normalizeCmd } = require('./util');

function sendMsg(room, text, targetId, color = 0x00FF7F, style = 'bold') {
  try {
    // Docker / Terminal loglarına çıktı ver
    console.log(`[BOT MSG] ${targetId ? `(Hedef ID: ${targetId}) ` : '(Genel) '}${text}`);
    room.sendAnnouncement(text, targetId, color, style, 1);
  } catch (err) {
    console.warn('sendAnnouncement hatası:', err.message);
  }
}

/**
 * Oyuncuyu ID (Haxball ID veya [100] etiketi) ya da İsim ile bulma yardımcısı.
 */
function resolveTargetPlayer(room, args, playerAssignments) {
  if (typeof room.getPlayerList !== 'function' || args.length < 2) {
    return { target: null, reason: '' };
  }

  const players = room.getPlayerList().filter((p) => p.id !== 0);
  const firstArg = args[1];

  // 1. Doğrudan Haxball ID eşleşmesi (ör. !kick 1)
  if (!isNaN(firstArg)) {
    const targetId = Number(firstArg);
    const pById = players.find((x) => x.id === targetId);
    if (pById) {
      return { target: pById, reason: args.slice(2).join(' ') };
    }
  }

  // 2. Parantez içi etiket eşleşmesi (ör. "[100] Loréx" için !kick 100)
  if (!isNaN(firstArg)) {
    const pByTag = players.find((p) => {
      const dName = (playerAssignments && playerAssignments.get(p.id)) || p.name || '';
      const tagMatch = dName.match(/^\[(\d+)\]/);
      return tagMatch && Number(tagMatch[1]) === Number(firstArg);
    });
    if (pByTag) {
      return { target: pByTag, reason: args.slice(2).join(' ') };
    }
  }

  // 3. Tam İsim eşleşmesi
  const fullInput = args.slice(1).join(' ').trim().toLowerCase();
  let match = players.find((p) => {
    const dName = ((playerAssignments && playerAssignments.get(p.id)) || p.name || '').toLowerCase();
    const rawName = (p.name || '').toLowerCase();
    const cleanName = rawName.replace(/^\[\d+\]\s*/, '').trim();
    return dName === fullInput || rawName === fullInput || cleanName === fullInput;
  });
  if (match) {
    return { target: match, reason: '' };
  }

  // 4. İlk kelime isim eşleşmesi
  const firstArgLower = firstArg.toLowerCase();
  match = players.find((p) => {
    const dName = ((playerAssignments && playerAssignments.get(p.id)) || p.name || '').toLowerCase();
    const rawName = (p.name || '').toLowerCase();
    const cleanName = rawName.replace(/^\[\d+\]\s*/, '').trim();
    return dName === firstArgLower || rawName === firstArgLower || cleanName === firstArgLower;
  });
  if (match) {
    return { target: match, reason: args.slice(2).join(' ') };
  }

  // 5. Kısmi İsim eşleşmesi
  const partialMatches = players.filter((p) => {
    const dName = ((playerAssignments && playerAssignments.get(p.id)) || p.name || '').toLowerCase();
    const rawName = (p.name || '').toLowerCase();
    return dName.includes(firstArgLower) || rawName.includes(firstArgLower) || dName.includes(fullInput);
  });

  if (partialMatches.length === 1) {
    return { target: partialMatches[0], reason: args.slice(2).join(' ') };
  }

  if (partialMatches.length > 1) {
    return { target: null, reason: '', candidates: partialMatches };
  }

  return { target: null, reason: '' };
}

function checkDuplicateLogin(room, player, { loggedInPlayers, CONFIG_ALLOW_MULTIPLE_JOIN = 0 }) {
  const playerToken = player.auth || player.conn || '';
  if (!playerToken) return false;
  if (typeof room.getPlayerList !== 'function') return false;

  const currentPlayers = room.getPlayerList();
  for (const p of currentPlayers) {
    const pToken = p.auth || p.conn || '';
    if (p.id !== player.id && pToken && pToken === playerToken && Number(CONFIG_ALLOW_MULTIPLE_JOIN) !== 1) {
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
        loggedInPlayers.set(player.id, { username: cleanedName, isadmin: row.isadmin });

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

function handlePlayerChat(room, player, msg, deps) {
  const {
    db,
    DB_FILE,
    loggedInPlayers,
    playerAssignments,
    persistDatabase,
    ADMIN_PASSWORD,
    afkPlayers,
    rebalanceTeams,
    CONFIG_ADMIN_CAN_BAN = 1,
    CONFIG_ADMIN_CAN_GIVE_ADMIN = 0,
    botManager = null,
    autoManager = null,
  } = deps;

  const text = String(msg || '').trim();

  const displayName = playerAssignments.get(player.id) || (player.name ? player.name.replace(/^\[\d{3}\]\s*/, '').trim() : '');
  const cleanedName = (player.name || '').replace(/^\[\d{3}\]\s*/, '').trim();

  const args = text.split(' ');
  const command = normalizeCmd(args[0] || '');
  const playerToken = player.auth || player.conn || '';

  const userData = loggedInPlayers.get(player.id);
  const isSuperAdmin = userData && userData.isadmin === 1;

  console.log(`[CHAT] ${displayName} : ${text}`);

  if (!text.startsWith('!')) {
    sendMsg(room, `💬 ${displayName}: ${text}`, null, 0xFFFFFF, 'normal');
    return false;
  }

  // Super-Admin Clear Bans
  if (command === '!clearbans' || command === '!clear_bans' || command === '!unbanall') {
    if (!isSuperAdmin) {
      sendMsg(room, '❌ Bu komutu sadece Super-Admin (Kurucu) kullanabilir!', player.id, 0xFF5555, 'bold');
      return false;
    }

    try {
      if (typeof room.clearBans === 'function') {
        room.clearBans();
        sendMsg(room, '🧹 Tüm banlar Super-Admin tarafından temizlendi!', null, 0x00FF7F, 'bold');
        console.log(`[SECURITY] Super-Admin ${cleanedName} (ID: ${player.id}) tüm banları temizledi.`);
      } else {
        sendMsg(room, '❌ Ban temizleme fonksiyonu odada aktif değil.', player.id, 0xFF5555, 'bold');
      }
    } catch (err) {
      console.warn('Banlar temizlenirken hata:', err.message);
      sendMsg(room, `❌ Banlar temizlenirken hata oluştu: ${err.message}`, player.id, 0xFF5555, 'bold');
    }
    return false;
  }

  // Super-Admin Blacklist (Kalıcı Veritabanı Banı)
  if (command === '!blacklist' || command === '!blackban' || command === '!permaban') {
    if (!isSuperAdmin) {
      sendMsg(room, '❌ Bu komutu sadece Super-Admin (Kurucu) kullanabilir!', player.id, 0xFF5555, 'bold');
      return false;
    }

    const { target, reason, candidates } = resolveTargetPlayer(room, args, playerAssignments);

    if (candidates && candidates.length > 1) {
      const candidateList = candidates.map((c) => `#${c.id} ${(playerAssignments.get(c.id) || c.name || '').trim()}`).join(', ');
      sendMsg(room, `⚠️ Birden fazla eşleşen oyuncu bulundu: ${candidateList}. Lütfen net bir ID/isim belirtin.`, player.id, 0xFFCC00, 'bold');
      return false;
    }

    if (!target) {
      sendMsg(room, '❌ Oyuncu bulunamadı! Kullanım: !blacklist <id / etiket / oyuncu_adı> [sebep]', player.id, 0xFF5555, 'bold');
      return false;
    }

    const targetUserData = loggedInPlayers.get(target.id);
    if (targetUserData && targetUserData.isadmin === 1) {
      sendMsg(room, '🛡️ Super-Admin (Kurucu) kara listeye alınamaz!', player.id, 0xFF5555, 'bold');
      return false;
    }

    const banReason = reason || 'Super-Admin tarafından kalıcı kara listeye alındınız.';
    const targetCleanName = (target.name || '').replace(/^\[\d{3}\]\s*/, '').trim();
    const targetAuth = target.auth || target.conn || '';
    const targetIp = target.ip || '';

    try {
      db.run(
        'INSERT INTO blacklisted_users (username, auth_key, ip, reason, banned_at) VALUES (?, ?, ?, ?, ?)',
        [targetCleanName, targetAuth, targetIp, banReason, new Date().toISOString()]
      );
      persistDatabase(db, DB_FILE);

      room.kickPlayer(target.id, banReason, true);
      sendMsg(room, `⛔ ${targetCleanName} (HB-ID: ${target.id}) veritabanı kara listesine (blacklisted_users) eklendi ve odadan yasaklandı!`, null, 0xFF0000, 'bold');
      console.log(`[BLACKLIST] Super-Admin ${cleanedName}, ${targetCleanName} kullanıcısını kara listeye ekledi. Auth: ${targetAuth}, IP: ${targetIp}`);
    } catch (err) {
      console.warn('[BLACKLIST] Veritabanı hatası:', err.message);
      sendMsg(room, `❌ Kara listeye ekleme hatası: ${err.message}`, player.id, 0xFF5555, 'bold');
    }
    return false;
  }

  // Oyuncu Listesi Komutu
  if (command === '!oyuncular' || command === '!oyunculistesi' || command === '!players') {
    if (typeof room.getPlayerList !== 'function') return false;

    const players = room.getPlayerList().filter((p) => p.id !== 0);
    if (players.length === 0) {
      sendMsg(room, '👥 Odada başka oyuncu bulunmuyor.', player.id, 0x00BFFF, 'normal');
      return false;
    }

    const playerListText = players
      .map((p) => {
        const dName = playerAssignments.get(p.id) || p.name || '';
        return `• [HB-ID: ${p.id}] ${dName}`;
      })
      .join('\n');

    sendMsg(room, `👥 Odadaki Oyuncular (${players.length}):\n${playerListText}`, player.id, 0x00BFFF, 'normal');
  } else if (command === '!afk') {
    if (afkPlayers.has(player.id)) {
      afkPlayers.delete(player.id);
      sendMsg(room, `🔔 ${displayName} artık AFK değil! Oyuna girmeye hazır.`, null, 0x00FF7F, 'bold');
    } else {
      afkPlayers.add(player.id);
      if (player.team !== 0 && typeof room.setPlayerTeam === 'function') {
        try {
          room.setPlayerTeam(player.id, 0);
        } catch (e) {}
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
          loggedInPlayers.set(player.id, { username: cleanedName, isadmin: 0 });

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

            loggedInPlayers.set(player.id, { username: cleanedName, isadmin: row.isadmin });

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
  } else if (command === '!ban') {
    if (!player.admin) {
      sendMsg(room, '❌ Bu komutu kullanmak için yönetici olmalısın.', player.id, 0xFF5555, 'bold');
      return false;
    }

    if (Number(CONFIG_ADMIN_CAN_BAN) === 0 && !isSuperAdmin) {
      sendMsg(room, '❌ Yönetici ban yetkisi kapalıdır!', player.id, 0xFF5555, 'bold');
      return false;
    }

    const { target, reason, candidates } = resolveTargetPlayer(room, args, playerAssignments);

    if (candidates && candidates.length > 1) {
      const candidateList = candidates.map((c) => `#${c.id} ${(playerAssignments.get(c.id) || c.name || '').trim()}`).join(', ');
      sendMsg(room, `⚠️ Birden fazla eşleşen oyuncu bulundu: ${candidateList}. Lütfen net bir ID/isim belirtin.`, player.id, 0xFFCC00, 'bold');
      return false;
    }

    if (!target) {
      sendMsg(room, '❌ Oyuncu bulunamadı! Kullanım: !ban <id / etiket / oyuncu_adı> [sebep]', player.id, 0xFF5555, 'bold');
      return false;
    }

    const targetUserData = loggedInPlayers.get(target.id);
    if (targetUserData && targetUserData.isadmin === 1) {
      sendMsg(room, '🛡️ Super-Admin (Kurucu) banlanamaz!', player.id, 0xFF5555, 'bold');
      return false;
    }

    const banReason = reason || 'Yönetici tarafından banlandınız.';
    const targetCleanName = playerAssignments.get(target.id) || target.name || '';

    try {
      room.kickPlayer(target.id, banReason, true);
      sendMsg(room, `🔨 ${targetCleanName} (HB-ID: ${target.id}) banlandı.`, player.id, 0x00FF7F, 'bold');
    } catch (err) {
      sendMsg(room, `❌ Oyuncu banlanamadı: ${err.message}`, player.id, 0xFF5555, 'bold');
    }
  } else if (command === '!kick') {
    if (!player.admin) {
      sendMsg(room, '❌ Bu komutu kullanmak için yönetici olmalısın.', player.id, 0xFF5555, 'bold');
      return false;
    }

    const { target, reason, candidates } = resolveTargetPlayer(room, args, playerAssignments);

    if (candidates && candidates.length > 1) {
      const candidateList = candidates.map((c) => `#${c.id} ${(playerAssignments.get(c.id) || c.name || '').trim()}`).join(', ');
      sendMsg(room, `⚠️ Birden fazla eşleşen oyuncu bulundu: ${candidateList}. Lütfen net bir ID/isim belirtin.`, player.id, 0xFFCC00, 'bold');
      return false;
    }

    if (!target) {
      sendMsg(room, '❌ Oyuncu bulunamadı! Kullanım: !kick <id / etiket / oyuncu_adı> [sebep]', player.id, 0xFF5555, 'bold');
      return false;
    }

    const targetUserData = loggedInPlayers.get(target.id);
    if (targetUserData && targetUserData.isadmin === 1) {
      sendMsg(room, '🛡️ Super-Admin (Kurucu) odadan atılamaz!', player.id, 0xFF5555, 'bold');
      return false;
    }

    const kickReason = reason || 'Yönetici tarafından atıldınız.';
    const targetCleanName = playerAssignments.get(target.id) || target.name || '';

    try {
      room.kickPlayer(target.id, kickReason, false);
      sendMsg(room, `👢 ${targetCleanName} (HB-ID: ${target.id}) odadan atıldı.`, player.id, 0x00FF7F, 'bold');
    } catch (err) {
      sendMsg(room, `❌ Oyuncu atılamadı: ${err.message}`, player.id, 0xFF5555, 'bold');
    }
  } else if (command === '!oto' || command === '!otomatik' || command === '!auto') {
    if (!player.admin && !isSuperAdmin) {
      sendMsg(room, '❌ Bu komutu kullanmak için yönetici olmalısın.', player.id, 0xFF5555, 'bold');
      return false;
    }

    if (!autoManager) {
      sendMsg(room, '❌ Otomatik yönetim denetimi bu odada aktif değil.', player.id, 0xFF5555, 'bold');
      return false;
    }

    const sub = normalizeCmd(args[1] || 'durum');

    if (sub === 'kapat' || sub === 'off' || sub === 'kapali') {
      if (!autoManager.isEnabled()) {
        sendMsg(room, 'ℹ️ Otomatik yönetim zaten kapalı.', player.id, 0xFFCC00, 'normal');
        return false;
      }
      autoManager.disable();
      sendMsg(
        room,
        `🔒 Otomatik yönetim KAPATILDI (${displayName}). Artık takım dağıtımı, otomatik maç başlatma ve maç sonu rotasyonu yapılmayacak.`,
        null,
        0xFFCC00,
        'bold'
      );
      console.log(`[AUTO] Otomatik yönetim kapatıldı -> ${cleanedName}`);
    } else if (sub === 'ac' || sub === 'on' || sub === 'acik') {
      if (autoManager.isEnabled()) {
        sendMsg(room, 'ℹ️ Otomatik yönetim zaten açık.', player.id, 0xFFCC00, 'normal');
        return false;
      }
      autoManager.enable();
      sendMsg(
        room,
        `🔓 Otomatik yönetim AÇILDI (${displayName}). Takım dağıtımı ve otomatik maç başlatma yeniden devrede.`,
        null,
        0x00FF7F,
        'bold'
      );
      console.log(`[AUTO] Otomatik yönetim açıldı -> ${cleanedName}`);
    } else if (sub === 'durum' || sub === 'status') {
      sendMsg(room, autoManager.status(), player.id, 0x00BFFF, 'normal');
    } else {
      sendMsg(room, '❌ Kullanım: !oto aç | !oto kapat | !oto durum', player.id, 0xFF5555, 'bold');
    }
  } else if (command === '!bot') {
    if (!player.admin && !isSuperAdmin) {
      sendMsg(room, '❌ Bot kontrolü için yönetici olmalısın.', player.id, 0xFF5555, 'bold');
      return false;
    }

    if (!botManager) {
      sendMsg(room, '❌ Bot yöneticisi bu odada aktif değil.', player.id, 0xFF5555, 'bold');
      return false;
    }

    const sub = normalizeCmd(args[1] || 'durum');

    if (sub === 'ac' || sub === 'on' || sub === 'baslat') {
      const result = botManager.start(args[2] || 1);
      sendMsg(room, result.message, null, result.ok ? 0x00FF7F : 0xFF5555, 'bold');
    } else if (sub === 'kapat' || sub === 'off' || sub === 'durdur') {
      const result = botManager.stop();
      sendMsg(room, result.message, null, result.ok ? 0x00FF7F : 0xFF5555, 'bold');
    } else if (sub === 'durum' || sub === 'status') {
      sendMsg(room, botManager.status(), player.id, 0x00BFFF, 'normal');
    } else {
      sendMsg(room, '❌ Kullanım: !bot aç [adet] | !bot kapat | !bot durum', player.id, 0xFF5555, 'bold');
    }
  } else if (command === '!yardim' || command === '!yardım' || command === '!help') {
    const helpText = [
      '📖 Spacebounce 4v4 - Komut listesi:',
      '• !oyuncular — Odadaki oyuncuları ve ID\'lerini listeler',
      '• !s / !stats / !istatistik — İstatistiklerinizi gösterir',
      '• !afk — AFK modunu açar/kapatır',
      '• !kaydol <şifre> — Hesap oluşturur ve oturum açar',
      '• !giris <şifre> — Mevcut hesabınıza giriş yapar',
      player.admin || isSuperAdmin ? '• !bot aç [adet] / !bot kapat / !bot durum — Yapay zeka botunu sahaya sürer (Yönetici)' : '',
      player.admin || isSuperAdmin ? '• !oto aç / !oto kapat / !oto durum — Otomatik takım dağıtımı ve maç başlatmayı açar/kapatır (Yönetici)' : '',
      isSuperAdmin ? '• !blacklist <id/isim> [sebep] — Oyuncuyu veritabanı kara listesine ekler (Super-Admin)' : '',
      isSuperAdmin ? '• !clearbans — Tüm banları temizler (Super-Admin)' : '',
    ]
      .filter(Boolean)
      .join('\n');

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