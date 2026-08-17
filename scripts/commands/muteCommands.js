const { normalizeCmd } = require('../util');
const { sendMsg } = require('./helpers');

function routeMuteCommand(ctx) {
  const { room, player, args, command, displayName, isSuperAdmin } = ctx;
  if (command !== '!mute' && command !== '!sohbet' && command !== '!chat') return null;

  if (!player.admin && !isSuperAdmin) {
    sendMsg(room, '❌ Sohbet kilidini sadece adminler değiştirebilir.', player.id, 0xFF5555, 'bold');
    return false;
  }

  const sub = normalizeCmd(args[1] || '');
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

module.exports = { routeMuteCommand };
