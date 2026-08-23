const { sendMsg, resolveTargetPlayer, candidateList } = require('./helpers');
const { isProtectedBotIdentity } = require('../room/botPolicy');
const { getOrCreatePlayerUid, isUserBlacklisted } = require('../db');

function fallbackT(key, vars = {}) {
  const messages = {
    'common.founderOnly': '❌ Bu komutu sadece Kurucu kullanabilir!',
    'common.multipleMatches': `⚠️ Birden fazla eşleşen oyuncu bulundu: ${vars.candidates}. Lütfen net bir ID/isim belirtin.`,
    'admin.clearBansSuccess': '🧹 Tüm banlar Kurucu tarafından temizlendi!',
    'admin.clearBansUnavailable': '❌ Ban temizleme fonksiyonu odada aktif değil.',
    'admin.clearBansError': `❌ Banlar temizlenirken hata oluştu: ${vars.error}`,
    'admin.blacklistUsage': '❌ Oyuncu bulunamadı! Kullanım: !blacklist <id / etiket / oyuncu_adı> [sebep]',
    'admin.blacklistBotProtected': '🛡️ Bot oyuncular kara listeye alınamaz.',
    'admin.blacklistFounderProtected': '🛡️ Kurucu kara listeye alınamaz!',
    'admin.blacklistAlready': `ℹ️ ${vars.name} zaten karalistede.`,
    'admin.blacklistSuccess': `⛔ ${vars.name} karalisteye eklendi ve odadan yasaklandı!`,
    'admin.blacklistError': `❌ Kara listeye ekleme hatası: ${vars.error}`,
    'admin.passwordBad': '❌ Admin şifresi hatalı.',
    'admin.passwordSuccess': '👑 Admin yetkisi verildi.',
    'admin.needAdmin': '❌ Bu komutu kullanmak için Admin olmalısın.',
    'admin.banDisabled': '❌ Admin ban yetkisi kapalıdır!',
    'admin.banUsage': '❌ Oyuncu bulunamadı! Kullanım: !ban <id / etiket / oyuncu_adı> [sebep]',
    'admin.banBotProtected': '🛡️ Bot oyuncular banlanamaz. Bot kaldırmak için !bot kapat veya !bot hepsi kullan.',
    'admin.banFounderProtected': '🛡️ Kurucu banlanamaz!',
    'admin.banSuccess': `🔨 ${vars.name} (HB-ID: ${vars.id}) banlandı.`,
    'admin.banError': `❌ Oyuncu banlanamadı: ${vars.error}`,
    'admin.kickUsage': '❌ Oyuncu bulunamadı! Kullanım: !kick <id / etiket / oyuncu_adı> [sebep]',
    'admin.kickFounderProtected': '🛡️ Kurucu odadan atılamaz!',
    'admin.kickSuccess': `👢 ${vars.name} (HB-ID: ${vars.id}) odadan atıldı.`,
    'admin.kickError': `❌ Oyuncu atılamadı: ${vars.error}`,
  };
  return messages[key] || key;
}

function routeAdminCommand(ctx) {
  if (ctx.commandKey === 'clearBans') return handleClearBans(ctx);
  if (ctx.commandKey === 'blacklist') return handleBlacklist(ctx);
  if (ctx.commandKey === 'ban') return handleBan(ctx);
  if (ctx.commandKey === 'kick') return handleKick(ctx);
  if (ctx.commandKey === 'adminLogin') return handleAdminPassword(ctx);
  return null;
}

function handleClearBans(ctx) {
  const { room, player, cleanedName } = ctx;
  const t = ctx.t || fallbackT;
  if (!(typeof ctx.hasCapability === 'function' && ctx.hasCapability('clear_bans'))) {
    sendMsg(room, t('common.founderOnly'), player.id, 0xFF5555, 'bold');
    return false;
  }

  try {
    if (typeof room.clearBans === 'function') {
      room.clearBans();
      sendMsg(room, t('admin.clearBansSuccess'), null, 0x00FF7F, 'bold');
      console.log(`[SECURITY] Kurucu ${cleanedName} (ID: ${player.id}) tüm banları temizledi.`);
    } else {
      sendMsg(room, t('admin.clearBansUnavailable'), player.id, 0xFF5555, 'bold');
    }
  } catch (err) {
    console.warn('Banlar temizlenirken hata:', err.message);
    sendMsg(room, t('admin.clearBansError', { error: err.message }), player.id, 0xFF5555, 'bold');
  }
  return false;
}

function handleBlacklist(ctx) {
  const { room, player, args, cleanedName, loggedInPlayers, playerAssignments, db, DB_FILE, persistDatabase, botManager } = ctx;
  const t = ctx.t || fallbackT;
  if (!(typeof ctx.hasCapability === 'function' && ctx.hasCapability('blacklist'))) {
    sendMsg(room, t('common.founderOnly'), player.id, 0xFF5555, 'bold');
    return false;
  }

  const { target, reason, candidates } = resolveTargetPlayer(room, args, playerAssignments);

  if (candidates && candidates.length > 1) {
    sendMsg(room, t('common.multipleMatches', { candidates: candidateList(candidates, playerAssignments) }), player.id, 0xFFCC00, 'bold');
    return false;
  }

  if (!target) {
    sendMsg(room, t('admin.blacklistUsage'), player.id, 0xFF5555, 'bold');
    return false;
  }

  if (isProtectedBotIdentity(botManager, target)) {
    sendMsg(room, t('admin.blacklistBotProtected'), player.id, 0xFFCC00, 'bold');
    return false;
  }

  const targetUserData = loggedInPlayers.get(target.id);
  if (targetUserData && targetUserData.role === 'owner') {
    sendMsg(room, t('admin.blacklistFounderProtected'), player.id, 0xFF5555, 'bold');
    return false;
  }

  const banReason = reason || 'Kalıcı kara listeye alındınız.';
  const targetCleanName = (target.name || '').replace(/^\[\d{3}\]\s*/, '').trim();
  const targetAuth = target.auth || target.conn || '';
  const targetIp = target.ip || '';

  try {
    if (isUserBlacklisted(db, targetCleanName, targetAuth)) {
      sendMsg(room, t('admin.blacklistAlready', { name: targetCleanName }), player.id, 0xFFCC00, 'bold');
      return false;
    }

    const targetPlayerUid = getOrCreatePlayerUid(db, targetCleanName, targetAuth);
    db.run(
      'INSERT INTO blacklisted_users (username, player_uid, auth_key, ip, reason, banned_at) VALUES (?, ?, ?, ?, ?, ?)',
      [targetCleanName, targetPlayerUid, targetAuth, targetIp, banReason, new Date().toISOString()]
    );
    persistDatabase(db, DB_FILE);

    room.kickPlayer(target.id, banReason, true);
    sendMsg(room, t('admin.blacklistSuccess', { name: targetCleanName }), null, 0xFF0000, 'bold');
    console.log(`[BLACKLIST] Kurucu ${cleanedName}, ${targetCleanName} kullanıcısını kara listeye ekledi. Auth: ${targetAuth}, IP: ${targetIp}`);
  } catch (err) {
    console.warn('[BLACKLIST] Veritabanı hatası:', err.message);
    sendMsg(room, t('admin.blacklistError', { error: err.message }), player.id, 0xFF5555, 'bold');
  }
  return false;
}

function handleAdminPassword(ctx) {
  const { room, player, args, ADMIN_PASSWORD } = ctx;
  const t = ctx.t || fallbackT;
  const password = args.slice(1).join(' ').trim();

  if (!ADMIN_PASSWORD || password !== ADMIN_PASSWORD) {
    sendMsg(room, t('admin.passwordBad'), player.id, 0xFF5555, 'bold');
    return false;
  }

  if (typeof room.setPlayerAdmin === 'function') {
    room.setPlayerAdmin(player.id, true);
    sendMsg(room, t('admin.passwordSuccess'), player.id, 0xFFD700, 'bold');
  }
  return false;
}

function handleBan(ctx) {
  const { room, player, args, loggedInPlayers, playerAssignments, botManager } = ctx;
  const t = ctx.t || fallbackT;
  if (!player.admin && !(typeof ctx.hasCapability === 'function' && ctx.hasCapability('ban'))) {
    sendMsg(room, t('admin.needAdmin'), player.id, 0xFF5555, 'bold');
    return false;
  }

  const { target, reason, candidates } = resolveTargetPlayer(room, args, playerAssignments);

  if (candidates && candidates.length > 1) {
    sendMsg(room, t('common.multipleMatches', { candidates: candidateList(candidates, playerAssignments) }), player.id, 0xFFCC00, 'bold');
    return false;
  }

  if (!target) {
    sendMsg(room, t('admin.banUsage'), player.id, 0xFF5555, 'bold');
    return false;
  }

  if (isProtectedBotIdentity(botManager, target)) {
    sendMsg(room, t('admin.banBotProtected'), player.id, 0xFFCC00, 'bold');
    return false;
  }

  const targetUserData = loggedInPlayers.get(target.id);
  if (targetUserData && targetUserData.role === 'owner') {
    sendMsg(room, t('admin.banFounderProtected'), player.id, 0xFF5555, 'bold');
    return false;
  }

  const banReason = reason || 'Admin tarafından banlandınız.';
  const targetCleanName = playerAssignments.get(target.id) || target.name || '';

  try {
    room.kickPlayer(target.id, banReason, true);
    sendMsg(room, t('admin.banSuccess', { name: targetCleanName, id: target.id }), player.id, 0x00FF7F, 'bold');
  } catch (err) {
    sendMsg(room, t('admin.banError', { error: err.message }), player.id, 0xFF5555, 'bold');
  }
  return false;
}

function handleKick(ctx) {
  const { room, player, args, loggedInPlayers, playerAssignments } = ctx;
  const t = ctx.t || fallbackT;
  if (!player.admin && !(typeof ctx.hasCapability === 'function' && ctx.hasCapability('kick'))) {
    sendMsg(room, t('admin.needAdmin'), player.id, 0xFF5555, 'bold');
    return false;
  }

  const { target, reason, candidates } = resolveTargetPlayer(room, args, playerAssignments);

  if (candidates && candidates.length > 1) {
    sendMsg(room, t('common.multipleMatches', { candidates: candidateList(candidates, playerAssignments) }), player.id, 0xFFCC00, 'bold');
    return false;
  }

  if (!target) {
    sendMsg(room, t('admin.kickUsage'), player.id, 0xFF5555, 'bold');
    return false;
  }

  const targetUserData = loggedInPlayers.get(target.id);
  if (targetUserData && targetUserData.role === 'owner') {
    sendMsg(room, t('admin.kickFounderProtected'), player.id, 0xFF5555, 'bold');
    return false;
  }

  const kickReason = reason || 'Admin tarafından atıldınız.';
  const targetCleanName = playerAssignments.get(target.id) || target.name || '';

  try {
    room.kickPlayer(target.id, kickReason, false);
    sendMsg(room, t('admin.kickSuccess', { name: targetCleanName, id: target.id }), player.id, 0x00FF7F, 'bold');
  } catch (err) {
    sendMsg(room, t('admin.kickError', { error: err.message }), player.id, 0xFF5555, 'bold');
  }
  return false;
}

module.exports = { routeAdminCommand };
