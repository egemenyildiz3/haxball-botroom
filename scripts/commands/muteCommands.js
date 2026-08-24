const { getCleanName, normalizeCmd } = require('../util');
const { sendMsg, resolveTargetPlayer, candidateList } = require('./helpers');
const { hasCapability } = require('../roles');

const DEFAULT_PLAYER_MUTE_MINUTES = 10;
const MAX_PLAYER_MUTE_MINUTES = 30;

function muteKey(player) {
  return player && (player.auth || player.conn || String(player.id));
}

function normalizedMuteName(name) {
  return String(name || '').trim().toLocaleLowerCase('tr-TR');
}

function muteKeysForPlayer(player, userData = null, playerAssignments = null) {
  if (!player) return [];

  const keys = new Set();
  if (player.auth) keys.add(`auth:${player.auth}`);
  if (player.conn) keys.add(`conn:${player.conn}`);
  if (userData && userData.player_uid) keys.add(`uid:${userData.player_uid}`);

  const assignedName = playerAssignments && playerAssignments.get(player.id);
  const cleanName = normalizedMuteName(getCleanName(player));
  const displayName = normalizedMuteName(assignedName || cleanName);
  if (cleanName) keys.add(`name:${cleanName}`);
  if (displayName) keys.add(`name:${displayName.replace(/^\[\d+\]\s*/, '').trim()}`);

  const legacyKey = muteKey(player);
  if (legacyKey) keys.add(legacyKey);
  if (player.id !== undefined && player.id !== null) keys.add(`id:${player.id}`);
  return [...keys].filter(Boolean);
}

function storeMute(mutedPlayers, player, userData, playerAssignments, mute) {
  const keys = muteKeysForPlayer(player, userData, playerAssignments);
  const entry = { ...mute, keys };
  for (const key of keys) {
    mutedPlayers.set(key, entry);
  }
  return entry;
}

function deleteMuteEntry(mutedPlayers, entry, fallbackKey = null) {
  const keys = new Set([fallbackKey, ...((entry && entry.keys) || [])].filter(Boolean));
  if (keys.size === 0 && fallbackKey) keys.add(fallbackKey);
  for (const key of keys) mutedPlayers.delete(key);
}

function findActiveMute(mutedPlayers, player, userData = null, playerAssignments = null, now = Date.now()) {
  if (!mutedPlayers) return null;

  for (const key of muteKeysForPlayer(player, userData, playerAssignments)) {
    const mute = mutedPlayers.get(key);
    if (!mute) continue;
    if (mute.until > now) return { key, mute };
    deleteMuteEntry(mutedPlayers, mute, key);
  }

  return null;
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
  const { room, player, args, displayName } = ctx;
  const t = ctx.t || ((key, vars = {}) => {
    const messages = {
      'mute.needAdmin': '❌ Sohbet kilidini sadece Admin değiştirebilir.',
      'mute.needUnmute': '❌ Susturma kaldırma komutunu kullanamazsınız.',
      'mute.globalOn': `🔇 Sohbet ${vars.name} tarafından susturuldu. Komutlar kullanılabilir.`,
      'mute.globalOff': `🔊 Sohbet ${vars.name} tarafından açıldı.`,
    };
    return messages[key] || key;
  });
  if (ctx.commandKey === 'unmute') return unmuteTargetPlayer(ctx);
  if (ctx.commandKey !== 'mute') return null;

  if (!(typeof ctx.hasCapability === 'function' && ctx.hasCapability('mute'))) {
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

function parseMuteTargetArgs(args) {
  if (args.length < 3) {
    return { targetArgs: args, minutes: DEFAULT_PLAYER_MUTE_MINUTES, wasCapped: false };
  }

  const last = args[args.length - 1];
  if (!/^\d+$/.test(String(last || '').trim())) {
    return { targetArgs: args, minutes: DEFAULT_PLAYER_MUTE_MINUTES, wasCapped: false };
  }

  const requested = Number(last);
  const minutes = Math.min(MAX_PLAYER_MUTE_MINUTES, Math.max(1, requested));
  return {
    targetArgs: args.slice(0, -1),
    minutes,
    wasCapped: requested > MAX_PLAYER_MUTE_MINUTES,
  };
}

function muteTargetPlayer(ctx) {
  const { room, player, args, playerAssignments, mutedPlayers, loggedInPlayers, roleCapabilities } = ctx;
  const t = ctx.t || ((key, vars = {}) => {
    const messages = {
      'mute.unavailable': '❌ Oyuncu susturma sistemi hazır değil.',
      'common.multipleMatches': `⚠️ Birden fazla eşleşen oyuncu bulundu: ${vars.candidates}. Lütfen net bir ID/isim belirtin.`,
      'mute.notFound': '❌ Oyuncu bulunamadı. Kullanım: !mute <id / etiket / oyuncu_adı> [dakika]',
      'mute.adminProtected': '🛡️ Adminler susturulamaz.',
      'mute.noIdentity': '❌ Oyuncu kimliği okunamadı, susturma uygulanamadı.',
      'mute.targetMuted': `🔇 ${vars.name} ${vars.minutes} dakikalığına susturuldu.`,
      'mute.targetNotice': `🔇 ${vars.minutes} dakika boyunca sohbete mesaj yazamazsınız. Komutları kullanabilirsiniz.`,
      'mute.durationCapped': `ℹ️ Maksimum susturma süresi ${vars.max} dakika. Süre ${vars.max} dk olarak ayarlandı.`,
    };
    return messages[key] || key;
  });
  if (!mutedPlayers) {
    sendMsg(room, t('mute.unavailable'), player.id, 0xFF5555, 'bold');
    return false;
  }

  const { targetArgs, minutes, wasCapped } = parseMuteTargetArgs(args);
  const { target, candidates } = resolveTargetPlayer(room, targetArgs, playerAssignments);

  if (candidates && candidates.length > 1) {
    sendMsg(room, t('common.multipleMatches', { candidates: candidateList(candidates, playerAssignments) }), player.id, 0xFFCC00, 'bold');
    return false;
  }

  if (!target) {
    sendMsg(room, t('mute.notFound'), player.id, 0xFF5555, 'bold');
    return false;
  }

  const targetUserData = loggedInPlayers && loggedInPlayers.get(target.id);
  if (hasCapability(targetUserData, 'mute_exempt', roleCapabilities)) {
    sendMsg(room, t('mute.adminProtected'), player.id, 0xFFCC00, 'bold');
    return false;
  }

  const keys = muteKeysForPlayer(target, targetUserData, playerAssignments);
  if (keys.length === 0) {
    sendMsg(room, t('mute.noIdentity'), player.id, 0xFF5555, 'bold');
    return false;
  }

  const until = Date.now() + minutes * 60 * 1000;
  const name = (playerAssignments && playerAssignments.get(target.id)) || target.name || 'Oyuncu';
  storeMute(mutedPlayers, target, targetUserData, playerAssignments, { until, name });

  if (wasCapped) {
    sendMsg(room, t('mute.durationCapped', { max: MAX_PLAYER_MUTE_MINUTES }), player.id, 0xFFCC00, 'bold');
  }
  sendMsg(room, t('mute.targetMuted', { name, minutes }), null, 0xFFCC00, 'bold');
  sendMsg(room, t('mute.targetNotice', { minutes }), target.id, 0xFFCC00, 'bold');
  return false;
}

function findMutedByName(mutedPlayers, args) {
  const input = args.slice(1).join(' ').trim().toLowerCase();
  if (!input) return null;

  let found = null;
  const seenEntries = new Set();
  for (const [key, value] of mutedPlayers.entries()) {
    if (seenEntries.has(value)) continue;
    seenEntries.add(value);
    const name = String((value && value.name) || '').toLowerCase();
    if (name === input || name.includes(input)) {
      if (found) return { ambiguous: true };
      found = { key, name: value.name || input };
    }
  }
  return found;
}

function unmuteTargetPlayer(ctx) {
  const { room, player, args, playerAssignments, mutedPlayers, loggedInPlayers } = ctx;
  const t = ctx.t || ((key, vars = {}) => {
    const messages = {
      'mute.needUnmute': '❌ Susturma kaldırma komutunu kullanamazsınız.',
      'mute.unavailable': '❌ Oyuncu susturma sistemi hazır değil.',
      'common.multipleMatches': `⚠️ Birden fazla eşleşen oyuncu bulundu: ${vars.candidates}. Lütfen net bir ID/isim belirtin.`,
      'mute.unmuteNotFound': '❌ Susturulmuş oyuncu bulunamadı. Kullanım: !unmute <id / etiket / oyuncu_adı>',
      'mute.targetUnmuted': `🔊 ${vars.name} artık sohbete yazabilir.`,
    };
    return messages[key] || key;
  });

  if (!(typeof ctx.hasCapability === 'function' && ctx.hasCapability('unmute'))) {
    sendMsg(room, t('mute.needUnmute'), player.id, 0xFF5555, 'bold');
    return false;
  }

  if (!mutedPlayers) {
    sendMsg(room, t('mute.unavailable'), player.id, 0xFF5555, 'bold');
    return false;
  }

  const { target, candidates } = resolveTargetPlayer(room, args, playerAssignments);
  if (candidates && candidates.length > 1) {
    sendMsg(room, t('common.multipleMatches', { candidates: candidateList(candidates, playerAssignments) }), player.id, 0xFFCC00, 'bold');
    return false;
  }

  const targetUserData = target && loggedInPlayers && loggedInPlayers.get(target.id);
  let name = target && ((playerAssignments && playerAssignments.get(target.id)) || target.name || 'Oyuncu');

  const activeMute = target ? findActiveMute(mutedPlayers, target, targetUserData, playerAssignments) : null;
  if (activeMute) {
    deleteMuteEntry(mutedPlayers, activeMute.mute, activeMute.key);
    sendMsg(room, t('mute.targetUnmuted', { name }), null, 0x00FF7F, 'bold');
    return false;
  }

  const mutedMatch = findMutedByName(mutedPlayers, args);
  if (mutedMatch && mutedMatch.ambiguous) {
    sendMsg(room, t('common.multipleMatches', { candidates: 'muted player names' }), player.id, 0xFFCC00, 'bold');
    return false;
  }
  if (mutedMatch) {
    deleteMuteEntry(mutedPlayers, mutedPlayers.get(mutedMatch.key), mutedMatch.key);
    sendMsg(room, t('mute.targetUnmuted', { name: mutedMatch.name }), null, 0x00FF7F, 'bold');
    return false;
  }

  sendMsg(room, t('mute.unmuteNotFound'), player.id, 0xFF5555, 'bold');
  return false;
}

module.exports = {
  routeMuteCommand,
  muteKey,
  muteKeysForPlayer,
  findActiveMute,
  deleteMuteEntry,
  minutesLeft,
};
