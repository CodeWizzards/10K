// ═══════════════════════════════════════════════════════════════════════════
// CRASH AUDITOR – app.js v4 (Dashboard Frontend)
// Tabela com seleção em massa, modos, SSE, copiar dados.
// ═══════════════════════════════════════════════════════════════════════════
(() => {
  "use strict";
  const API = "/api";
  const $ = id => document.getElementById(id);

  // Operador padrão (pode ser configurável depois)
  const OPERATOR = "spy";

  // ─── Elements ─────────────────────────────────────────────────────
  const gsTotal = $("gs-total");
  const gsActive = $("gs-active");
  const gsBalance = $("gs-balance");
  const accountsBody = $("accounts-body");
  const emptyRow = $("empty-row");
  const logFeed = $("log-feed");
  const checkAll = $("check-all");
  const btnModeDup = $("btn-mode-dup");
  const btnModeTarget = $("btn-mode-target");
  const targetGroup = $("target-group");
  const inpTarget = $("inp-target");
  const btnStartSelected = $("btn-start-selected");
  const btnStopAll = $("btn-stop-all");
  const modalOverlay = $("modal-overlay");
  const modalTitle = $("modal-title");
  const accountForm = $("account-form");
  const deleteModal = $("delete-modal");
  const deleteMessage = $("delete-message");
  const toastRegion = $("toast-region");
  const cpfInput = $("inp-cpf");
  const chkTestMode = $("chk-testmode");

  let accounts = [];
  let currentMode = "duplicate";
  let pendingDeleteId = null;
  let isUpdatingTestMode = false;

  // ─── Helpers ──────────────────────────────────────────────────────
  function fmtBRL(cents) {
    return `R$ ${(cents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;
  }
  function esc(s) { return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;"); }
  function cpfMask(value) {
    const digits = String(value || "").replace(/\D/g, "").slice(0, 11);
    return digits.replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d{1,2})$/, "$1-$2");
  }
  function showToast(message, type = "info") {
    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    toastRegion.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add("visible"));
    setTimeout(() => { toast.classList.remove("visible"); setTimeout(() => toast.remove(), 220); }, 3400);
  }

  async function api(method, path, body) {
    const opts = { method, headers: { "Content-Type": "application/json" } };
    if (body) opts.body = JSON.stringify(body);
    return (await fetch(API + path, opts)).json();
  }

  function statusBadge(status) {
    const map = {
      active: ["status-active", "🟢", "Ativa"],
      running: ["status-running", "🟡", "Rodando"],
      error: ["status-error", "🔴", "Erro"],
    };
    const [cls, , label] = map[status] || ["status-idle", "⚪", status || "Idle"];
    return `<span class="status-badge ${cls}"><span class="status-dot"></span>${label}</span>`;
  }

  // ─── Render accounts ─────────────────────────────────────────────
  function renderAccounts(accs) {
    accounts = accs;
    // Limpa rows existentes exceto empty
    accountsBody.querySelectorAll("tr:not(#empty-row)").forEach(r => r.remove());

    if (!accs.length) {
      emptyRow.style.display = "";
      syncCheckAll();
      return;
    }
    emptyRow.style.display = "none";

    for (const acc of accs) {
      const tr = document.createElement("tr");
      tr.dataset.id = acc.id;

      const bal = acc.liveBalance ?? acc.balance ?? 0;
      const cpfDisplay = acc.cpf || "—";
      const exampleLabel = acc.isTestAccount ? '<span class="test-account-label">EXEMPLO</span>' : '';

      tr.innerHTML = `
        <td class="col-check"><input type="checkbox" class="row-check" data-id="${acc.id}" /></td>
        <td class="col-cpf"><span class="cpf-text">${esc(cpfDisplay)}</span></td>
        <td class="col-name"><span class="name-text">${esc(acc.name)}</span>${exampleLabel}</td>
        <td class="col-status">${statusBadge(acc.isRunning ? 'running' : acc.status)}</td>
        <td class="col-balance"><span class="balance-text">${fmtBRL(bal)}</span></td>
        <td class="col-actions">
          <div class="row-actions">
            ${acc.isTestAccount ? `
              <button class="row-btn" title="Copiar CPF fictício" data-action="copy-cpf" data-val="${esc(acc.cpf || '')}">📋</button>
              <button class="row-btn" title="Copiar sessão fictícia" data-action="copy-sid" data-val="${esc(acc.sid || '')}">🔗</button>
              <button class="row-btn danger" title="Remover conta de teste" data-action="delete" data-id="${acc.id}">🗑️</button>` : `
              <button class="row-btn" title="Copiar CPF" data-action="copy-cpf" data-val="${esc(acc.cpf || '')}">📋</button>
              <button class="row-btn" title="Copiar Senha" data-action="copy-pwd" data-val="${esc(acc.password || '')}">🔑</button>
              <button class="row-btn" title="Editar" data-action="edit" data-id="${acc.id}">✏️</button>
              <button class="row-btn danger" title="Remover" data-action="delete" data-id="${acc.id}">🗑️</button>`}
          </div>
        </td>
      `;
      accountsBody.appendChild(tr);
    }
    syncCheckAll();
  }

  // ─── Load ─────────────────────────────────────────────────────────
  async function loadAccounts() {
    const res = await api("GET", `/accounts?operator=${OPERATOR}`);
    if (res.ok) renderAccounts(res.accounts);
  }

  async function loadStats() {
    const res = await api("GET", `/stats?operator=${OPERATOR}`);
    if (res.ok) {
      gsTotal.textContent = res.stats.totalAccounts;
      gsActive.textContent = res.stats.activeBots;
      gsBalance.textContent = fmtBRL(res.stats.totalBalance);
      if (!isUpdatingTestMode && chkTestMode && chkTestMode.checked !== res.isTestMode) {
        chkTestMode.checked = res.isTestMode;
      }
    }
  }

  async function refresh() { await Promise.all([loadAccounts(), loadStats()]); }

  // ─── Mode switching ──────────────────────────────────────────────
  function setMode(mode) {
    currentMode = mode;
    btnModeDup.classList.toggle("active", mode === "duplicate");
    btnModeTarget.classList.toggle("active", mode === "target");
    targetGroup.style.display = mode === "target" ? "flex" : "none";

    const target = mode === "target" ? parseFloat(inpTarget.value) || 10 : null;
    api("POST", "/mode", { mode, target });
  }

  btnModeDup.addEventListener("click", () => setMode("duplicate"));
  btnModeTarget.addEventListener("click", () => setMode("target"));
  inpTarget.addEventListener("change", () => {
    if (currentMode === "target") {
      api("POST", "/mode", { mode: "target", target: parseFloat(inpTarget.value) || 10 });
    }
  });

  if (chkTestMode) {
    chkTestMode.addEventListener("change", async () => {
      const requested = chkTestMode.checked;
      isUpdatingTestMode = true;
      chkTestMode.disabled = true;
      try {
        const res = await api("POST", "/testmode", { enabled: requested });
        if (!res.ok) throw new Error(res.error || "Falha ao atualizar o modo teste.");
        chkTestMode.checked = res.isTestMode === true;
        showToast(
          res.isTestMode
            ? "Modo teste ativado: nenhuma requisição real será enviada."
            : "Modo teste desativado.",
          "success"
        );
        await refresh();
      } catch (err) {
        chkTestMode.checked = !requested;
        showToast(err.message || "Não foi possível atualizar o modo teste.", "error");
      } finally {
        chkTestMode.disabled = false;
        isUpdatingTestMode = false;
      }
    });
  }

  // ─── Selection ───────────────────────────────────────────────────
  function getSelectedIds() {
    return [...accountsBody.querySelectorAll(".row-check:checked")].map(cb => cb.dataset.id);
  }
  function isAccountRunning(acc) {
    return Boolean(acc?.isRunning) || acc?.status === "running";
  }
  function getStartableIds() {
    return getSelectedIds().filter(id => !isAccountRunning(accounts.find(acc => acc.id === id)));
  }
  function updateActionButtons() {
    const selectedStartable = getStartableIds().length;
    const running = accounts.some(isAccountRunning);
    btnStartSelected.disabled = selectedStartable === 0;
    btnStopAll.disabled = !running;
    btnStartSelected.title = selectedStartable ? "Iniciar contas selecionadas" : "Selecione uma conta parada para iniciar";
    btnStopAll.title = running ? "Parar todas as contas em execução" : "Nenhuma conta está em execução";
  }

  checkAll.addEventListener("change", () => {
    accountsBody.querySelectorAll(".row-check").forEach(cb => cb.checked = checkAll.checked);
    syncCheckAll();
  });
  accountsBody.addEventListener("change", e => {
    if (e.target.classList.contains("row-check")) syncCheckAll();
  });
  function syncCheckAll() {
    const checks = [...accountsBody.querySelectorAll(".row-check")];
    checkAll.checked = checks.length > 0 && checks.every(cb => cb.checked);
    checkAll.indeterminate = checks.some(cb => cb.checked) && !checkAll.checked;
    updateActionButtons();
  }

  // ─── Start/Stop ──────────────────────────────────────────────────
  btnStartSelected.addEventListener("click", async () => {
    const ids = getStartableIds();
    if (!ids.length) return showToast("Selecione pelo menos uma conta para iniciar.", "warning");
    await api("POST", "/batch/start", { ids });
    showToast(`${ids.length} conta${ids.length > 1 ? "s" : ""} iniciada${ids.length > 1 ? "s" : ""}.`, "success");
    await refresh();
  });

  btnStopAll.addEventListener("click", async () => {
    await api("POST", "/batch/stop", {});
    showToast("Todas as contas foram interrompidas.", "info");
    await refresh();
  });

  // ─── Table actions (delegation) ──────────────────────────────────
  accountsBody.addEventListener("click", async (e) => {
    const btn = e.target.closest(".row-btn");
    if (!btn) return;

    const action = btn.dataset.action;

    if (action === "copy-cpf" || action === "copy-pwd" || action === "copy-sid") {
      const val = btn.dataset.val;
      if (val) {
        await navigator.clipboard.writeText(val);
        btn.textContent = "✓";
        showToast(action === "copy-cpf" ? "CPF copiado." : action === "copy-sid" ? "Sessão fictícia copiada." : "Senha copiada.", "success");
        setTimeout(() => btn.textContent = action === "copy-cpf" ? "📋" : action === "copy-sid" ? "🔗" : "🔑", 1000);
      }
    }
    if (action === "edit") {
      const acc = accounts.find(a => a.id === btn.dataset.id);
      if (acc) openModal("edit", acc);
    }
    if (action === "delete") {
      const acc = accounts.find(a => a.id === btn.dataset.id);
      openDeleteModal(btn.dataset.id, acc?.name);
    }
  });

  // ─── Modal ───────────────────────────────────────────────────────
  function openModal(mode, acc = null) {
    modalOverlay.hidden = false;
    if (mode === "edit" && acc) {
      modalTitle.textContent = "Editar Conta";
      $("inp-name").value = acc.name || "";
      $("inp-sid").value = acc.sid || "";
      $("inp-cpf").value = cpfMask(acc.cpf);
      $("inp-password").value = acc.password || "";
      $("inp-pcid").value = acc.player_casino_id || "";
      $("inp-edit-id").value = acc.id;
    } else {
      modalTitle.textContent = "Adicionar Conta";
      accountForm.reset();
      $("inp-edit-id").value = "";
    }
    $("inp-name").focus();
  }

  function closeModal() { modalOverlay.hidden = true; accountForm.reset(); }

  $("btn-add").addEventListener("click", () => openModal("add"));
  $("btn-add-empty")?.addEventListener("click", () => openModal("add"));
  $("btn-modal-cancel").addEventListener("click", closeModal);
  $("modal-close").addEventListener("click", closeModal);
  modalOverlay.addEventListener("click", e => { if (e.target === modalOverlay) closeModal(); });
  cpfInput.addEventListener("input", () => { cpfInput.value = cpfMask(cpfInput.value); });

  function openDeleteModal(id, name) {
    pendingDeleteId = id;
    deleteMessage.textContent = name ? `“${name}” será removida do painel. Esta ação não pode ser desfeita.` : "Esta conta será removida do painel. Esta ação não pode ser desfeita.";
    deleteModal.hidden = false;
    $("btn-delete-cancel").focus();
  }
  function closeDeleteModal() { deleteModal.hidden = true; pendingDeleteId = null; }
  $("btn-delete-cancel").addEventListener("click", closeDeleteModal);
  deleteModal.addEventListener("click", e => { if (e.target === deleteModal) closeDeleteModal(); });
  $("btn-delete-confirm").addEventListener("click", async () => {
    if (!pendingDeleteId) return;
    const id = pendingDeleteId;
    const confirmBtn = $("btn-delete-confirm");
    confirmBtn.disabled = true;
    confirmBtn.textContent = "Removendo…";
    try {
      await api("DELETE", `/accounts/${id}`);
      closeDeleteModal();
      await refresh();
      showToast("Conta removida com sucesso.", "success");
    } catch (_) {
      showToast("Não foi possível remover a conta. Tente novamente.", "error");
    } finally {
      confirmBtn.disabled = false;
      confirmBtn.textContent = "Remover conta";
    }
  });

  accountForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = $("inp-name").value.trim();
    const sid = $("inp-sid").value.trim();
    const cpf = cpfMask($("inp-cpf").value);
    const password = $("inp-password").value.trim();
    const playerCasinoId = $("inp-pcid").value.trim();
    const editId = $("inp-edit-id").value;

    if (editId) {
      await api("PATCH", `/accounts/${editId}`, { name, sid, cpf, password, player_casino_id: playerCasinoId });
    } else {
      if (!name) return showToast("Informe o nome da conta.", "warning");
      await api("POST", "/accounts", { operator: OPERATOR, name, sid, cpf, password, playerCasinoId });
    }
    closeModal();
    await refresh();
    showToast(editId ? "Conta atualizada com sucesso." : "Conta adicionada com sucesso.", "success");
  });

  // ─── SSE ─────────────────────────────────────────────────────────
  function connectSSE() {
    const src = new EventSource(`${API}/logs/stream`);
    src.onmessage = (evt) => {
      try {
        const entry = JSON.parse(evt.data);

        if (entry.type === "log") {
          renderLogEntry(entry);
          updateRowLive(entry);
        }
        if (entry.type === "account_sync" || entry.type === "account_error") {
          refresh();
        }
        if (entry.type === "test_mode" && !isUpdatingTestMode && chkTestMode) {
          chkTestMode.checked = entry.enabled === true;
        }
      } catch (_) {}
    };
    src.onerror = () => { src.close(); setTimeout(connectSSE, 3000); };
  }

  function renderLogEntry(entry) {
    const emptyEl = logFeed.querySelector(".log-empty");
    if (emptyEl) emptyEl.remove();

    const div = document.createElement("div");
    div.className = "log-entry";
    const time = new Date(entry.timestamp).toLocaleTimeString("pt-BR");
    div.innerHTML = `<span class="log-time">${time}</span><span class="log-account">[${esc(entry.account)}]</span> ${esc(entry.message)}`;
    logFeed.prepend(div);
    while (logFeed.children.length > 200) logFeed.lastChild.remove();
  }

  function updateRowLive(entry) {
    const row = accountsBody.querySelector(`tr[data-id="${entry.accountId}"]`);
    if (!row) return;
    // Atualiza saldo
    if (entry.balance != null) {
      const balEl = row.querySelector(".balance-text");
      if (balEl) balEl.textContent = fmtBRL(entry.balance);
    }
    // Atualiza status
    const statusCell = row.querySelector(".col-status");
    if (statusCell && entry.phase) {
      const isRunning = entry.phase !== "IDLE" && entry.phase !== "COMPLETED_CYCLE";
      statusCell.innerHTML = statusBadge(isRunning ? "running" : "active");
    }
    // Refresh stats
    loadStats();
  }

  // ─── Other ───────────────────────────────────────────────────────
  $("btn-clear-logs").addEventListener("click", () => {
    logFeed.innerHTML = `<div class="log-empty">Aguardando eventos...</div>`;
  });
  $("btn-refresh").addEventListener("click", refresh);
  document.addEventListener("keydown", e => {
    if (e.key !== "Escape") return;
    if (!deleteModal.hidden) closeDeleteModal();
    else if (!modalOverlay.hidden) closeModal();
  });

  setInterval(refresh, 8000);

  // ─── Init ────────────────────────────────────────────────────────
  updateActionButtons();
  refresh();
  connectSSE();
})();
