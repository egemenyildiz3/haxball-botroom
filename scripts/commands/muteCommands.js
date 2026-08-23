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
  const t = ctx.t || ((key, vars = {}) => {
    const messages = {
      'mute.needAdmin': '❌ Sohbet kilidini sadece Admin değiştirebilir.',
      'mute.globalOn': `🔇 Sohbet ${vars.name} tarafından susturuldu. Komutlar kullanılabilir.`,
      'mute.globalOff': `🔊 Sohbet ${vars.name} tarafından açıldı.`,
    };
    return messages[key] || key;
  });
  if (command !== '!mute' && command !== '!sohbet' && command !== '!chat') return null;

  if (!player.admin && !isSuperAdmin) {
    sendMsg(room, t('mute.needAdmin'), player.id, 0xFF5555, 'bold');
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
    sendMsg(room, t('mute.globalOn', { name: displayName }), null, 0xFFCC00, 'bold');
  } else {
    sendMsg(room, t('mute.globalOff', { name: displayName }), null, 0x00FF7F, 'bold');
  }

  return false;
}

function muteTargetPlayer(ctx) {
  const { room, player, args, playerAssignments, mutedPlayers, loggedInPlayers } = ctx;
  const t = ctx.t || ((key, vars = {}) => {
    const messages = {
      'mute.unavailable': '❌ Oyuncu susturma sistemi hazır değil.',
      'common.multipleMatches': `⚠️ Birden fazla eşleşen oyuncu bulundu: ${vars.candidates}. Lütfen net bir ID/isim belirtin.`,
      'mute.notFound': '❌ Oyuncu bulunamadı. Kullanım: !mute <id / etiket / oyuncu_adı>',
      'mute.adminProtected': '🛡️ Adminler susturulamaz.',
      'mute.noIdentity': '❌ Oyuncu kimliği okunamadı, susturma uygulanamadı.',
      'mute.targetMuted': `🔇 ${vars.name} 10 dakikalığına susturuldu.`,
      'mute.targetNotice': '🔇 10 dakika boyunca sohbete mesaj yazamazsınız. Komutları kullanabilirsiniz.',
    };
    return messages[key] || key;
  });
  if (!mutedPlayers) {
    sendMsg(room, t('mute.unavailable'), player.id, 0xFF5555, 'bold');
    return false;
  }

  const { target, candidates } = resolveTargetPlayer(room, args, playerAssignments);

  if (candidates && candidates.length > 1) {
    sendMsg(room, t('common.multipleMatches', { candidates: candidateList(candidates, playerAssignments) }), player.id, 0xFFCC00, 'bold');
    return false;
  }

  if (!target) {
    sendMsg(room, t('mute.notFound'), player.id, 0xFF5555, 'bold');
    return false;
  }

  const targetUserData = loggedInPlayers && loggedInPlayers.get(target.id);
  if (target.admin || (targetUserData && targetUserData.isadmin === 1)) {
    sendMsg(room, t('mute.adminProtected'), player.id, 0xFFCC00, 'bold');
    return false;
  }

  const key = muteKey(target);
  if (!key) {
    sendMsg(room, t('mute.noIdentity'), player.id, 0xFF5555, 'bold');
    return false;
  }

  const until = Date.now() + PLAYER_MUTE_MS;
  const name = (playerAssignments && playerAssignments.get(target.id)) || target.name || 'Oyuncu';
  mutedPlayers.set(key, { until, name });

  sendMsg(room, t('mute.targetMuted', { name }), null, 0xFFCC00, 'bold');
  sendMsg(room, t('mute.targetNotice'), target.id, 0xFFCC00, 'bold');
  return false;
}

module.exports = { routeMuteCommand, muteKey, minutesLeft };
