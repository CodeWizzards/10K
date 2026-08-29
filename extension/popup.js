document.addEventListener("DOMContentLoaded", async () => {
  const inpOperator = document.getElementById("inp-operator");
  const inpServer = document.getElementById("inp-server");
  const btnSave = document.getElementById("btn-save");
  const statusMsg = document.getElementById("status-msg");
  const settingsForm = document.getElementById("settings-form");
  const sessionCard = document.getElementById("session-card");
  const sessionEyebrow = document.getElementById("session-eyebrow");
  const sessionTitle = document.getElementById("session-title");
  const sessionDetail = document.getElementById("session-detail");
  const sessionCount = document.getElementById("session-count");

  function renderSessionState(data) {
    const sessions = data.detectedSessions || [];
    const latest = sessions[0];
    sessionCount.textContent = sessions.length;
    if (!latest) return;
    const isSynced = latest.status === "synced";
    const isError = latest.status === "error";
    sessionCard.dataset.status = isSynced ? "success" : isError ? "error" : "syncing";
    sessionEyebrow.textContent = isSynced ? "Sincronização concluída" : isError ? "Sincronização pendente" : "Sessão identificada";
    sessionTitle.textContent = latest.name || "Sessão identificada";
    sessionDetail.textContent = isSynced ? "✓ Sessão enviada ao painel com sucesso." : isError ? `⚠ ${latest.error || "Não foi possível enviar ao painel."}` : "Enviando sessão ao painel…";
  }

  // Carrega
  const data = await chrome.storage.local.get(["operator", "serverUrl", "detectedSessions"]);
  inpOperator.value = data.operator || "";
  inpServer.value = data.serverUrl || "http://localhost:3000";
  renderSessionState(data);

  chrome.storage.onChanged.addListener((_changes, area) => {
    if (area === "local") chrome.storage.local.get(["detectedSessions"]).then(renderSessionState);
  });

  // Salva
  settingsForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const operator = inpOperator.value.trim();
    const serverUrl = inpServer.value.trim();

    if (!operator || !serverUrl) {
      statusMsg.style.color = "#ef4444";
      statusMsg.textContent = "Preencha tudo.";
      return;
    }

    btnSave.disabled = true;
    btnSave.querySelector("span").textContent = "Salvando…";
    await chrome.storage.local.set({ operator, serverUrl });
    statusMsg.style.color = "#68dda0";
    statusMsg.textContent = "Configurações salvas!";
    btnSave.disabled = false;
    btnSave.querySelector("span").textContent = "Salvar configurações";
    setTimeout(() => { statusMsg.textContent = ""; }, 2400);
  });
});
