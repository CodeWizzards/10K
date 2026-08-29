// ═══════════════════════════════════════════════════════════════════════════
// CRASH AUDITOR – bridge.js (world: ISOLATED)
// Ouve as mensagens do content.js (MAIN) e manda pro background.js
// ═══════════════════════════════════════════════════════════════════════════

window.addEventListener("message", (event) => {
  // Ignora se não vier da própria página ou não for o tipo esperado
  if (event.source !== window || !event.data || !event.data.type) return;

  if (event.data.type === "CRASH_AUDITOR_SYNC") {
    // Repassa pro background processar e mandar pro servidor
    chrome.runtime.sendMessage(event.data);
  }
});
