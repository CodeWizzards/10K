// ═══════════════════════════════════════════════════════════════════════════
// CRASH AUDITOR – content.js (world: MAIN)
// Intercepta fetch/XHR para capturar playerCasinoId + SID do launcher.
// Comunica via window.postMessage → bridge.js → background.js
// ═══════════════════════════════════════════════════════════════════════════
(() => {
  "use strict";

  // Padrões de URL que interessam (launcher/proxy do bananaprovider)
  const LAUNCHER_PATTERNS = ["bananaprovider", "launcher", "proxy"];
  const GAME_PATTERNS = ["/game/auth", "/game/getCurrentRoundInfo"];

  function isLauncherUrl(url) {
    return LAUNCHER_PATTERNS.some(p => url.toLowerCase().includes(p));
  }
  function isGameUrl(url) {
    return GAME_PATTERNS.some(p => url.includes(p));
  }

  function processResponse(url, bodyText) {
    try {
      const data = JSON.parse(bodyText);

      // ── Launcher: captura playerCasinoId + sid + nome ────────────
      if (isLauncherUrl(url)) {
        const playerCasinoId = data.playerCasinoId || data.player_casino_id || data.playerId;
        const sid = data.sid || data.sessionId || data.session_id;
        const name = data.playerName || data.player_name || data.name || data.nickname || "";

        if (playerCasinoId && sid) {
          window.postMessage({
            type: "CRASH_AUDITOR_SYNC",
            playerCasinoId: String(playerCasinoId),
            sid: String(sid),
            name: decodeURIComponent(name || "")
          }, "*");
          console.log("[Crash Auditor] 🔄 Launcher interceptado:", { playerCasinoId, sid: sid.slice(0, 8) + "…" });
        }
      }

      // ── Game auth/out: captura sid + balance ────────────────────
      if (isGameUrl(url) && data.sid) {
        window.postMessage({
          type: "CRASH_AUDITOR_SESSION",
          sid: data.sid,
          balance: data.balance ?? null,
          baseUrl: new URL(url).origin
        }, "*");
      }
    } catch (_) {}
  }

  // ─── Intercepta fetch ───────────────────────────────────────────
  const _fetch = window.fetch.bind(window);
  window.fetch = async function (input, init = {}) {
    const url = typeof input === "string" ? input : (input instanceof Request ? input.url : String(input));
    const response = await _fetch(input, init);

    if (isLauncherUrl(url) || isGameUrl(url)) {
      response.clone().text().then(t => processResponse(url, t)).catch(() => {});
    }
    return response;
  };

  // ─── Intercepta XHR ─────────────────────────────────────────────
  const _XHR = window.XMLHttpRequest;
  function PatchedXHR() {
    const xhr = new _XHR();
    let _url = "";
    const origOpen = xhr.open;
    xhr.open = function (method, url) {
      _url = url;
      origOpen.apply(this, arguments);
    };
    const origSend = xhr.send;
    xhr.send = function (body) {
      this.addEventListener("load", function () {
        if (isLauncherUrl(_url) || isGameUrl(_url)) {
          processResponse(_url, this.responseText || "");
        }
      });
      origSend.apply(this, arguments);
    };
    return xhr;
  }
  PatchedXHR.prototype = _XHR.prototype;
  window.XMLHttpRequest = PatchedXHR;

  console.log("[Crash Auditor] ✅ Content script carregado (MAIN)");
})();
