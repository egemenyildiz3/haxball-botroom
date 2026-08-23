const { normalizeCmd } = require('../util');
const { sendMsg } = require('./helpers');

function routeAutoCommand(ctx) {
  const { room, player, args, displayName, cleanedName, autoManager } = ctx;
  const t = ctx.t || ((key, vars = {}) => {
    const messages = {
      'auto.needFounder': '❌ Bu komutu kullanmak için Kurucu olmalısın.',
      'auto.unavailable': '❌ Otomatik yönetim denetimi bu odada aktif değil.',
      'auto.alreadyOff': 'ℹ️ Otomatik yönetim zaten kapalı.',
      'auto.alreadyOn': 'ℹ️ Otomatik yönetim zaten açık.',
      'auto.off': `🔒 Otomatik yönetim KAPATILDI (${vars.name}). Artık takım dağıtımı, otomatik maç başlatma ve maç sonu rotasyonu yapılmayacak.`,
      'auto.on': `🔓 Otomatik yönetim AÇILDI (${vars.name}). Takım dağıtımı ve otomatik maç başlatma yeniden devrede.`,
      'auto.usage': '❌ Kullanım: !oto aç | !oto kapat | !oto durum',
    };
    return messages[key] || key;
  });
  if (ctx.commandKey !== 'auto') return null;

  if (!(typeof ctx.hasCapability === 'function' && ctx.hasCapability('auto'))) {
    sendMsg(room, t('auto.needFounder'), player.id, 0xFF5555, 'bold');
    return false;
  }

  if (!autoManager) {
    sendMsg(room, t('auto.unavailable'), player.id, 0xFF5555, 'bold');
    return false;
  }

  const sub = normalizeCmd(args[1] || 'durum');

  if (sub === 'kapat' || sub === 'off' || sub === 'kapali' || sub === 'disable') {
    if (!autoManager.isEnabled()) {
      sendMsg(room, t('auto.alreadyOff'), player.id, 0xFFCC00, 'normal');
      return false;
    }
    autoManager.disable();
    sendMsg(
      room,
      t('auto.off', { name: displayName }),
      null,
      0xFFCC00,
      'bold'
    );
    console.log(`[AUTO] Otomatik yönetim kapatıldı -> ${cleanedName}`);
  } else if (sub === 'ac' || sub === 'on' || sub === 'acik' || sub === 'enable') {
    if (autoManager.isEnabled()) {
      sendMsg(room, t('auto.alreadyOn'), player.id, 0xFFCC00, 'normal');
      return false;
    }
    autoManager.enable();
    sendMsg(
      room,
      t('auto.on', { name: displayName }),
      null,
      0x00FF7F,
      'bold'
    );
    console.log(`[AUTO] Otomatik yönetim açıldı -> ${cleanedName}`);
  } else if (sub === 'durum' || sub === 'status') {
    sendMsg(room, autoManager.status(), player.id, 0x00BFFF, 'normal');
  } else {
    sendMsg(room, t('auto.usage'), player.id, 0xFF5555, 'bold');
  }

  return false;
}

module.exports = { routeAutoCommand };
