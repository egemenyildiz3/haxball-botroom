const { normalizeCmd } = require('../util');
const { sendMsg, resolveTargetPlayer, candidateList } = require('./helpers');

const PLAYER_MUTE_MS = 10 * 60 * 1000;

function muteKey(player) {
  return player && (player.auth || player.conn || String(player.id));
}

function minutesLeft(ms) {
  return Math.max(1, Math.ceil(ms / 60000));
}

function isGlobalMuteSub(sub) {
  return [
    '',
    'ac',
    'on',
    'kilitle',
    'sustur',
    'kapat',
    'kapali',
    'off',
    'kaldir',
    'unlock',
  ].includes(sub);
}

function routeMuteCommand(ctx) {
  const { room, player, args, command, displayName, isSuperAdmin } = ctx;
  if (command !== '!mute' && command !== '!sohbet' && command !== '!chat') return null;

  if (!player.admin && !isSuperAdmin) {
    sendMsg(room, '❌ Sohbet kilidini sadece adminler değiştirebilir.', player.id, 0xFF5555, 'bold');
    return false;
  }

  const sub = normalizeCmd(args[1] || '');
  if (!isGlobalMuteSub(sub)) {
    return muteTargetPlayer(ctx);
  }

  const enable = sub === 'ac' || sub === 'on' || sub === 'kilitle' || sub === 'sustur'
    ? true
    : sub === 'kapat' || sub === 'kapali' || sub === 'off' || sub === 'kaldir' || sub === 'unlock'
      ? false
      : !ctx.chatMuted;

  ctx.setChatMuted(enable);

  if (enable) {
    sendMsg(room, `🔇 Sohbet ${displayName} tarafından susturuldu. Komutlar kullanılabilir.`, null, 0xFFCC00, 'bold');
  } else {
    sendMsg(room, `🔊 Sohbet ${displayName} tarafından açıldı.`, null, 0x00FF7F, 'bold');
  }

  return false;
}

function muteTargetPlayer(ctx) {
  const { room, player, args, playerAssignments, mutedPlayers, loggedInPlayers } = ctx;
  if (!mutedPlayers) {
    sendMsg(room, '❌ Oyuncu susturma sistemi hazır değil.', player.id, 0xFF5555, 'bold');
    return false;
  }

  const { target, candidates } = resolveTargetPlayer(room, args, playerAssignments);

  if (candidates && candidates.length > 1) {
    sendMsg(room, `⚠️ Birden fazla eşleşen oyuncu bulundu: ${candidateList(candidates, playerAssignments)}. Lütfen net bir ID/isim belirtin.`, player.id, 0xFFCC00, 'bold');
    return false;
  }

  if (!target) {
    sendMsg(room, '❌ Oyuncu bulunamadı. Kullanım: !mute <id / etiket / oyuncu_adı>', player.id, 0xFF5555, 'bold');
    return false;
  }

  const targetUserData = loggedInPlayers && loggedInPlayers.get(target.id);
  if (target.admin || (targetUserData && targetUserData.isadmin === 1)) {
    sendMsg(room, '🛡️ Adminler susturulamaz.', player.id, 0xFFCC00, 'bold');
    return false;
  }

  const key = muteKey(target);
  if (!key) {
    sendMsg(room, '❌ Oyuncu kimliği okunamadı, susturma uygulanamadı.', player.id, 0xFF5555, 'bold');
    return false;
  }

  const until = Date.now() + PLAYER_MUTE_MS;
  const name = (playerAssignments && playerAssignments.get(target.id)) || target.name || 'Oyuncu';
  mutedPlayers.set(key, { until, name });

  sendMsg(room, `🔇 ${name} 10 dakikalığına susturuldu.`, null, 0xFFCC00, 'bold');
  sendMsg(room, '🔇 10 dakika boyunca sohbete mesaj yazamazsınız. Komutları kullanabilirsiniz.', target.id, 0xFFCC00, 'bold');
  return false;
}

module.exports = { routeMuteCommand, muteKey, minutesLeft };
