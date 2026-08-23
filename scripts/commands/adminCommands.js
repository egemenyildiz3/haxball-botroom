const { sendMsg, resolveTargetPlayer, candidateList } = require('./helpers');
const { isProtectedBotIdentity } = require('../room/botPolicy');
const { isUsernameBlacklisted } = require('../db');

function routeAdminCommand(ctx) {
  const { command } = ctx;
  if (command === '!clearbans' || command === '!clear_bans' || command === '!unbanall') return handleClearBans(ctx);
  if (command === '!blacklist' || command === '!blackban' || command === '!permaban') return handleBlacklist(ctx);
  if (command === '!ban') return handleBan(ctx);
  if (command === '!kick') return handleKick(ctx);
  if (command === '!adminol') return handleAdminPassword(ctx);
  return null;
}

function handleClearBans(ctx) {
  const { room, player, cleanedName, isSuperAdmin } = ctx;
  if (!isSuperAdmin) {
    sendMsg(room, '❌ Bu komutu sadece Kurucu kullanabilir!', player.id, 0xFF5555, 'bold');
    return false;
  }

  try {
    if (typeof room.clearBans === 'function') {
      room.clearBans();
      sendMsg(room, '🧹 Tüm banlar Kurucu tarafından temizlendi!', null, 0x00FF7F, 'bold');
      console.log(`[SECURITY] Kurucu ${cleanedName} (ID: ${player.id}) tüm banları temizledi.`);
    } else {
      sendMsg(room, '❌ Ban temizleme fonksiyonu odada aktif değil.', player.id, 0xFF5555, 'bold');
    }
  } catch (err) {
    console.warn('Banlar temizlenirken hata:', err.message);
    sendMsg(room, `❌ Banlar temizlenirken hata oluştu: ${err.message}`, player.id, 0xFF5555, 'bold');
  }
  return false;
}

function handleBlacklist(ctx) {
  const { room, player, args, cleanedName, isSuperAdmin, loggedInPlayers, playerAssignments, db, DB_FILE, persistDatabase, botManager } = ctx;
  if (!isSuperAdmin) {
    sendMsg(room, '❌ Bu komutu sadece Kurucu kullanabilir!', player.id, 0xFF5555, 'bold');
    return false;
  }

  const { target, reason, candidates } = resolveTargetPlayer(room, args, playerAssignments);

  if (candidates && candidates.length > 1) {
    sendMsg(room, `⚠️ Birden fazla eşleşen oyuncu bulundu: ${candidateList(candidates, playerAssignments)}. Lütfen net bir ID/isim belirtin.`, player.id, 0xFFCC00, 'bold');
    return false;
  }

  if (!target) {
    sendMsg(room, '❌ Oyuncu bulunamadı! Kullanım: !blacklist <id / etiket / oyuncu_adı> [sebep]', player.id, 0xFF5555, 'bold');
    return false;
  }

  if (isProtectedBotIdentity(botManager, target)) {
    sendMsg(room, '🛡️ Bot oyuncular kara listeye alınamaz.', player.id, 0xFFCC00, 'bold');
    return false;
  }

  const targetUserData = loggedInPlayers.get(target.id);
  if (targetUserData && targetUserData.isadmin === 1) {
    sendMsg(room, '🛡️ Kurucu kara listeye alınamaz!', player.id, 0xFF5555, 'bold');
    return false;
  }

  const banReason = reason || 'Kalıcı kara listeye alındınız.';
  const targetCleanName = (target.name || '').replace(/^\[\d{3}\]\s*/, '').trim();
  const targetAuth = target.auth || target.conn || '';
  const targetIp = target.ip || '';

  try {
    if (isUsernameBlacklisted(db, targetCleanName)) {
      sendMsg(room, `ℹ️ ${targetCleanName} zaten karalistede.`, player.id, 0xFFCC00, 'bold');
      return false;
    }

    db.run(
      'INSERT INTO blacklisted_users (username, auth_key, ip, reason, banned_at) VALUES (?, ?, ?, ?, ?)',
      [targetCleanName, targetAuth, targetIp, banReason, new Date().toISOString()]
    );
    persistDatabase(db, DB_FILE);

    room.kickPlayer(target.id, banReason, true);
    sendMsg(room, `⛔ ${targetCleanName} karalisteye eklendi ve odadan yasaklandı!`, null, 0xFF0000, 'bold');
    console.log(`[BLACKLIST] Kurucu ${cleanedName}, ${targetCleanName} kullanıcısını kara listeye ekledi. Auth: ${targetAuth}, IP: ${targetIp}`);
  } catch (err) {
    console.warn('[BLACKLIST] Veritabanı hatası:', err.message);
    sendMsg(room, `❌ Kara listeye ekleme hatası: ${err.message}`, player.id, 0xFF5555, 'bold');
  }
  return false;
}

function handleAdminPassword(ctx) {
  const { room, player, args, ADMIN_PASSWORD } = ctx;
  const password = args.slice(1).join(' ').trim();

  if (!ADMIN_PASSWORD || password !== ADMIN_PASSWORD) {
    sendMsg(room, '❌ Admin şifresi hatalı.', player.id, 0xFF5555, 'bold');
    return false;
  }

  if (typeof room.setPlayerAdmin === 'function') {
    room.setPlayerAdmin(player.id, true);
    sendMsg(room, '👑 Admin yetkisi verildi.', player.id, 0xFFD700, 'bold');
  }
  return false;
}

function handleBan(ctx) {
  const { room, player, args, isSuperAdmin, loggedInPlayers, playerAssignments, CONFIG_ADMIN_CAN_BAN, botManager } = ctx;
  if (!player.admin) {
    sendMsg(room, '❌ Bu komutu kullanmak için admin olmalısın.', player.id, 0xFF5555, 'bold');
    return false;
  }

  if (Number(CONFIG_ADMIN_CAN_BAN) === 0 && !isSuperAdmin) {
    sendMsg(room, '❌ Admin ban yetkisi kapalıdır!', player.id, 0xFF5555, 'bold');
    return false;
  }

  const { target, reason, candidates } = resolveTargetPlayer(room, args, playerAssignments);

  if (candidates && candidates.length > 1) {
    sendMsg(room, `⚠️ Birden fazla eşleşen oyuncu bulundu: ${candidateList(candidates, playerAssignments)}. Lütfen net bir ID/isim belirtin.`, player.id, 0xFFCC00, 'bold');
    return false;
  }

  if (!target) {
    sendMsg(room, '❌ Oyuncu bulunamadı! Kullanım: !ban <id / etiket / oyuncu_adı> [sebep]', player.id, 0xFF5555, 'bold');
    return false;
  }

  if (isProtectedBotIdentity(botManager, target)) {
    sendMsg(room, '🛡️ Bot oyuncular banlanamaz. Bot kaldırmak için !bot kapat veya !bot hepsi kullan.', player.id, 0xFFCC00, 'bold');
    return false;
  }

  const targetUserData = loggedInPlayers.get(target.id);
  if (targetUserData && targetUserData.isadmin === 1) {
    sendMsg(room, '🛡️ Kurucu banlanamaz!', player.id, 0xFF5555, 'bold');
    return false;
  }

  const banReason = reason || 'Admin tarafından banlandınız.';
  const targetCleanName = playerAssignments.get(target.id) || target.name || '';

  try {
    room.kickPlayer(target.id, banReason, true);
    sendMsg(room, `🔨 ${targetCleanName} (HB-ID: ${target.id}) banlandı.`, player.id, 0x00FF7F, 'bold');
  } catch (err) {
    sendMsg(room, `❌ Oyuncu banlanamadı: ${err.message}`, player.id, 0xFF5555, 'bold');
  }
  return false;
}

function handleKick(ctx) {
  const { room, player, args, loggedInPlayers, playerAssignments } = ctx;
  if (!player.admin) {
    sendMsg(room, '❌ Bu komutu kullanmak için Admin olmalısın.', player.id, 0xFF5555, 'bold');
    return false;
  }

  const { target, reason, candidates } = resolveTargetPlayer(room, args, playerAssignments);

  if (candidates && candidates.length > 1) {
    sendMsg(room, `⚠️ Birden fazla eşleşen oyuncu bulundu: ${candidateList(candidates, playerAssignments)}. Lütfen net bir ID/isim belirtin.`, player.id, 0xFFCC00, 'bold');
    return false;
  }

  if (!target) {
    sendMsg(room, '❌ Oyuncu bulunamadı! Kullanım: !kick <id / etiket / oyuncu_adı> [sebep]', player.id, 0xFF5555, 'bold');
    return false;
  }

  const targetUserData = loggedInPlayers.get(target.id);
  if (targetUserData && targetUserData.isadmin === 1) {
    sendMsg(room, '🛡️ Kurucu odadan atılamaz!', player.id, 0xFF5555, 'bold');
    return false;
  }

  const kickReason = reason || 'Admin tarafından atıldınız.';
  const targetCleanName = playerAssignments.get(target.id) || target.name || '';

  try {
    room.kickPlayer(target.id, kickReason, false);
    sendMsg(room, `👢 ${targetCleanName} (HB-ID: ${target.id}) odadan atıldı.`, player.id, 0x00FF7F, 'bold');
  } catch (err) {
    sendMsg(room, `❌ Oyuncu atılamadı: ${err.message}`, player.id, 0xFF5555, 'bold');
  }
  return false;
}

module.exports = { routeAdminCommand };
