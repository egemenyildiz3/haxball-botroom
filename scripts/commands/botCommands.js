const { normalizeCmd } = require('../util');
const { sendMsg } = require('./helpers');

function routeBotCommand(ctx) {
  const { room, player, args, command, isSuperAdmin, botManager } = ctx;
  const t = ctx.t || ((key) => ({
    'bot.needAdmin': '❌ Bot kontrolü için Admin olmalısın.',
    'bot.unavailable': '❌ Bot yöneticisi bu odada aktif değil.',
    'bot.usage': '❌ Kullanım: !bot aç [adet] | !bot kapat | !bot hepsi | !bot durum',
  }[key] || key));
  if (command !== '!bot') return null;

  if (!player.admin && !isSuperAdmin) {
    sendMsg(room, t('bot.needAdmin'), player.id, 0xFF5555, 'bold');
    return false;
  }

  if (!botManager) {
    sendMsg(room, t('bot.unavailable'), player.id, 0xFF5555, 'bold');
    return false;
  }

  const sub = normalizeCmd(args[1] || 'durum');

  if (sub === 'ac' || sub === 'on' || sub === 'baslat') {
    const result = botManager.start(args[2] || 1);
    sendMsg(room, result.message, null, result.ok ? 0x00FF7F : 0xFF5555, 'bold');
  } else if (sub === 'kapat' || sub === 'off' || sub === 'durdur') {
    const result = typeof botManager.stopLast === 'function' ? botManager.stopLast() : botManager.stop();
    sendMsg(room, result.message, null, result.ok ? 0x00FF7F : 0xFF5555, 'bold');
  } else if (sub === 'hepsi' || sub === 'all' || sub === 'temizle') {
    const result = botManager.stop();
    sendMsg(room, result.message, null, result.ok ? 0x00FF7F : 0xFF5555, 'bold');
  } else if (sub === 'durum' || sub === 'status') {
    sendMsg(room, botManager.status(), player.id, 0x00BFFF, 'normal');
  } else {
    sendMsg(room, t('bot.usage'), player.id, 0xFF5555, 'bold');
  }

  return false;
}

module.exports = { routeBotCommand };
