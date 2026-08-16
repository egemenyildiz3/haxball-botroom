/**
 * Odayı node-haxball ile açar ama haxball.js ile aynı (headless) arayüzü döner.
 *
 * Neden? node-haxball host modunda "sahte oyuncu" (fakePlayerJoin +
 * fakeSendPlayerInput) desteği var. Bu sayede bot, ağ üzerinden tekrar odaya
 * bağlanmak zorunda kalmadan doğrudan host process içinde oynayabiliyor.
 * Aynı makineden WebRTC ile kendi odana bağlanmak NAT yüzünden çoğu ev
 * ağında çalışmıyor (FailedHost hatası) - bu yöntem o sorunu tamamen atlar.
 *
 * headlessWrapper.js "nhInstance" alanını onOpen'dan ÖNCE atadığı için hep
 * null kalıyor; bu yüzden ham oda nesnesini Room.create'i geçici olarak
 * sarmalayarak yakalıyoruz.
 */

const API = require('node-haxball')();
const headlessWrapper = require('node-haxball/src/headlessWrapper');

const { HBInit } = headlessWrapper(API);

/**
 * @param {object} config haxball.js HBInit ile aynı yapı
 * @returns {{ room: object, raw: object|null, api: object }}
 *          room = headless uyumlu arayüz, raw = node-haxball ham oda nesnesi
 */
function createHostRoom(config) {
  let raw = null;

  const originalCreate = API.Room.create;
  API.Room.create = function (createParams, commonParams) {
    const userOnOpen = commonParams.onOpen;
    commonParams.onOpen = (r) => {
      raw = r;
      if (typeof userOnOpen === 'function') userOnOpen(r);
    };
    return originalCreate.call(this, createParams, commonParams);
  };

  let room;
  try {
    room = HBInit(config);
  } finally {
    API.Room.create = originalCreate;
  }

  return {
    room,
    api: API,
    getRaw: () => raw,
  };
}

module.exports = { createHostRoom, API };
