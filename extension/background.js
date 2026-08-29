// Recebe sessões capturadas, sincroniza com o painel e mantém um status claro
// no ícone e no popup da extensão.
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'CRASH_AUDITOR_SYNC') handleSync(msg);
  return true;
});

async function updateBadge(sessions) {
  const count = sessions.length;
  await chrome.action.setBadgeText({ text: count ? String(Math.min(count, 99)) : '' });
  await chrome.action.setBadgeBackgroundColor({ color: '#34c77b' });
  await chrome.action.setTitle({ title: count ? `Crash Auditor — ${count} sessão${count === 1 ? '' : 'ões'} identificada${count === 1 ? '' : 's'}` : 'Crash Auditor' });
}

function saveSession(sessions, data, status, error = '') {
  const key = `${data.playerCasinoId}:${data.sid}`;
  const previous = sessions.find(item => item.key === key);
  const item = { key, playerCasinoId: data.playerCasinoId, name: data.name || 'Sessão identificada', status, error, detectedAt: previous?.detectedAt || Date.now(), updatedAt: Date.now() };
  return [item, ...sessions.filter(entry => entry.key !== key)].slice(0, 99);
}

async function handleSync(data) {
  const stored = await chrome.storage.local.get(['operator', 'serverUrl', 'detectedSessions']);
  const operator = stored.operator || 'spy';
  const serverUrl = stored.serverUrl || 'http://localhost:3000';
  let sessions = saveSession(stored.detectedSessions || [], data, 'syncing');
  await chrome.storage.local.set({ detectedSessions: sessions, lastStatus: 'syncing', lastSession: data.name || 'Sessão identificada' });
  await updateBadge(sessions);

  try {
    const response = await fetch(`${serverUrl.replace(/\/$/, '')}/api/sync`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operator, playerCasinoId: data.playerCasinoId, sid: data.sid, name: data.name })
    });
    if (!response.ok) throw new Error(`Erro HTTP ${response.status}`);
    sessions = saveSession(sessions, data, 'synced');
    await chrome.storage.local.set({ detectedSessions: sessions, lastStatus: 'success', lastSync: Date.now(), lastSession: data.name || 'Sessão identificada' });
    await updateBadge(sessions);
    console.log('[Crash Auditor Ext] Sessão sincronizada com sucesso.');
  } catch (error) {
    sessions = saveSession(sessions, data, 'error', error.message || 'Falha de rede');
    await chrome.storage.local.set({ detectedSessions: sessions, lastStatus: 'error', lastSync: Date.now(), lastSession: data.name || 'Sessão identificada' });
    await updateBadge(sessions);
    console.error('[Crash Auditor Ext] Falha ao sincronizar:', error);
  }
}

chrome.storage.local.get(['detectedSessions']).then(({ detectedSessions = [] }) => updateBadge(detectedSessions));
