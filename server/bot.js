// ═══════════════════════════════════════════════════════════════════════════
// CRASH AUDITOR – bot.js v4
// Com tratamento de erro 400 (conta pausada) + callbacks para manager.
// ═══════════════════════════════════════════════════════════════════════════

export class CrashBot {
  constructor(account, { mode = 'duplicate', target = null, baseUrl = null, onLog = null, onError = null, onBalanceUpdate = null }) {
    this.accountId = account.id;
    this.accountName = account.name || 'Sem nome';
    this.sid = account.sid;
    this.mode = mode;           // 'duplicate' ou 'target'
    this.targetMultiplier = target;

    this.onLog = onLog;
    this.onError = onError;           // callback quando erro 400
    this.onBalanceUpdate = onBalanceUpdate;

    this.baseUrl = baseUrl || "https://gamelogic.space-crash.prod.o-br1.banana.games";
    this.MUTATION_CHAR = "\u001a";
    this.POLL_MS = 1000;
    this.FAST_POLL_MS = 300;
    this.MAX_BET = 50000;

    this.state = {
      phase: "IDLE",
      balance: 0,
      pendingBets: [],
      stats: { profit: 0, cycles: 0, totalBet: 0, totalCollected: 0, roundsWaited: 0, targetHits: 0 }
    };

    this.isRunning = false;
    this.firstCycle = true;
  }

  // ─── Logging ──────────────────────────────────────────────────────────
  log(msg) {
    const time = new Date().toLocaleTimeString("pt-BR");
    console.log(`[${time}] [${this.accountName}] ${msg}`);
    if (this.onLog) {
      this.onLog(this.accountId, this.accountName, msg, {
        phase: this.state.phase,
        balance: this.state.balance,
        stats: { ...this.state.stats }
      });
    }
  }

  setPhase(phase) {
    this.state.phase = phase;
    this.log(`⚙️ ${phase}`);
  }

  sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  async post(path, payload) {
    try {
      const res = await fetch(this.baseUrl + path, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify(payload)
      });
      let data = null;
      try { data = await res.json(); } catch (_) { }
      return { ok: res.ok, status: res.status, data };
    } catch (error) {
      this.log(`❌ Rede: ${error.message}`);
      return { ok: false, status: 0, data: null };
    }
  }

  // ─── Cálculo de apostas ─────────────────────────────────────────────
  calcBets(balCents) {
    if (balCents <= 0) return [];
    if (balCents <= this.MAX_BET) return [balCents];
    if (balCents <= this.MAX_BET * 2) return [this.MAX_BET, balCents - this.MAX_BET];
    return [this.MAX_BET, this.MAX_BET];
  }

  // ─── Endpoints ──────────────────────────────────────────────────────
  getRound() { return this.post("/game/getCurrentRoundInfo", { sid: this.sid }); }

  placeBet(amtCents) {
    return this.post("/game/bet", {
      sid: this.sid,
      am: parseFloat((amtCents / 100).toFixed(2)),
      isAutoCollected: false,
      autoCollectTargetValue: 1.1,
      bananaServerFreeSpinOrBonusId: null
    });
  }

  cancelMutated(code) {
    return this.post("/game/cancelBet", { sid: this.sid, betCode: code + this.MUTATION_CHAR });
  }

  collectBet(code) {
    return this.post("/game/collectBet", { sid: this.sid, betCode: code });
  }

  // ─── Controle ───────────────────────────────────────────────────────
  async start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.firstCycle = true;

    this.log(`🚀 Iniciado | Modo: ${this.mode === 'target' ? `Alvo ${this.targetMultiplier}x` : 'Duplicar'}`);

    const init = await this.getRound();
    if (init.ok && init.data?.balance != null) {
      this.state.balance = init.data.balance;
      this._notifyBalance();
      this.log(`💳 Saldo: R$${(this.state.balance / 100).toFixed(2)}`);
    }

    while (this.isRunning) {
      try {
        await this.runCycle();
      } catch (err) {
        this.log(`❌ Erro: ${err.message}`);
        await this.sleep(3000);
      }
      if (this.isRunning) await this.sleep(500);
    }
    this.setPhase("IDLE");
    this.log("⏹ Parado.");
  }

  stop() {
    this.isRunning = false;
    this.log("🛑 Parando...");
  }

  getStatus() {
    return {
      id: this.accountId,
      name: this.accountName,
      phase: this.state.phase,
      balance: this.state.balance,
      mode: this.mode,
      target: this.targetMultiplier,
      isRunning: this.isRunning,
      stats: { ...this.state.stats }
    };
  }

  _notifyBalance() {
    if (this.onBalanceUpdate) this.onBalanceUpdate(this.accountId, this.state.balance);
  }

  // ─── Ciclo principal ────────────────────────────────────────────────
  async runCycle() {
    if (!this.sid) { this.log("❌ SID ausente."); this.stop(); return; }

    // 1) SYNC
    if (this.firstCycle) {
      this.setPhase("SYNCING");
      this.log("🔄 Sync: RUNNING → OPEN");
      let seenRunning = false;
      for (let i = 0; i < 600 && this.isRunning; i++) {
        const r = await this.getRound();
        if (r.ok && r.data?.status) {
          if (r.data.status === "RUNNING" && !seenRunning) { seenRunning = true; this.log("🔄 RUNNING visto"); }
          if (r.data.status === "OPEN" && seenRunning) {
            if (r.data.balance != null) { this.state.balance = r.data.balance; this._notifyBalance(); }
            this.log("✅ Sincronizado");
            break;
          }
        }
        if (i === 599) { this.log("⚠️ Timeout sync"); return; }
        await this.sleep(this.POLL_MS);
      }
      this.firstCycle = false;
    } else {
      this.setPhase("WAITING_OPEN");
      for (let i = 0; i < 300 && this.isRunning; i++) {
        const r = await this.getRound();
        if (r.ok && r.data?.status === "OPEN") {
          if (r.data.balance != null) { this.state.balance = r.data.balance; this._notifyBalance(); }
          break;
        }
        if (i === 299) { this.log("⚠️ Timeout OPEN"); return; }
        await this.sleep(this.POLL_MS);
      }
    }
    if (!this.isRunning) return;

    // Saldo check
    const pre = await this.getRound();
    if (pre.ok && pre.data?.balance != null) { this.state.balance = pre.data.balance; this._notifyBalance(); }

    // 2) BET + CANCEL MUTADO
    const amounts = this.calcBets(this.state.balance);
    if (!amounts.length) { this.log("💸 Saldo zero."); this.stop(); return; }

    this.state.pendingBets = [];
    this.setPhase("BETTING");

    for (const amt of amounts) {
      const betRes = await this.placeBet(amt);

      // ── DETECÇÃO DE ERRO 400 ────────────────────────────────────────
      if (!betRes.ok) {
        if (betRes.status === 400 && betRes.data?.error?.includes("debit")) {
          this.log(`🔴 CONTA BLOQUEADA: ${betRes.data.error}`);
          if (this.onError) this.onError(this.accountId, betRes.data.error);
          this.stop();
          return;
        }
        this.log(`❌ BET falhou HTTP ${betRes.status}: ${JSON.stringify(betRes.data)}`);
        continue;
      }

      const code = betRes.data?.betCode || betRes.data?.id;
      if (!code) { this.log("❌ betCode ausente"); continue; }

      this.state.stats.totalBet += amt;
      if (betRes.data?.playerBalance != null) { this.state.balance = betRes.data.playerBalance; this._notifyBalance(); }
      this.log(`🎲 BET R$${(amt / 100).toFixed(2)} – ${code}`);

      const cancelRes = await this.cancelMutated(code);
      if (cancelRes.data?.playerBalance != null) { this.state.balance = cancelRes.data.playerBalance; this._notifyBalance(); }
      this.log(`🚫 CANCEL – HTTP ${cancelRes.status} – Saldo: R$${(this.state.balance / 100).toFixed(2)}`);

      this.state.pendingBets.push({ betCode: code, amount: amt });
    }

    if (!this.state.pendingBets.length) { this.log("❌ Nenhuma aposta OK."); return; }

    // 3) AGUARDA RUNNING
    this.setPhase("WAITING_RUNNING");
    let gotRunning = false;
    for (let i = 0; i < 120 && this.isRunning; i++) {
      const r = await this.getRound();
      if (r.ok && (r.data?.status === "RUNNING" || r.data?.canCollect === true)) { gotRunning = true; break; }
      await this.sleep(this.POLL_MS);
    }
    if (!gotRunning) { this.log("⚠️ Timeout RUNNING"); return; }

    // 4) COLETA
    if (this.mode === 'duplicate' || !this.targetMultiplier) {
      // DUPLICAR: coleta imediato
      this.setPhase("COLLECTING");
      this.log("💰 Coletando (duplicar)...");
      await this._collectAll();
    } else {
      // ALVO: monitora multiplicador
      this.setPhase("WAITING_TARGET");
      this.log(`🎯 Esperando ${this.targetMultiplier}x...`);
      let collected = false;

      while (this.isRunning) {
        const r = await this.getRound();
        if (!r.ok || !r.data) { await this.sleep(this.FAST_POLL_MS); continue; }

        const status = r.data.status;
        const multi = r.data.multiplier ?? r.data.currentMultiplier ?? r.data.crashPoint ?? 1;

        if (status === "CRASHED" || status === "FINISHED" || (status === "OPEN" && !this.firstCycle)) {
          this.state.stats.roundsWaited++;
          this.log(`💥 Crashou ${multi}x < ${this.targetMultiplier}x (sem prejuízo)`);
          break;
        }

        if (status === "RUNNING" && multi >= this.targetMultiplier) {
          this.log(`🎯 ALVO! ${multi}x >= ${this.targetMultiplier}x`);
          this.setPhase("COLLECTING");
          this.state.stats.targetHits++;
          await this._collectAll();
          collected = true;
          break;
        }
        await this.sleep(this.FAST_POLL_MS);
      }
      if (!collected) this.log("⏭️ Próximo round.");
    }

    // 5) CONCLUÍDO
    this.state.stats.cycles++;
    this.state.stats.profit = this.state.stats.totalCollected - this.state.stats.totalBet;
    this.log(`🏁 #${this.state.stats.cycles} | Lucro: R$${(this.state.stats.profit / 100).toFixed(2)} | Saldo: R$${(this.state.balance / 100).toFixed(2)}`);
    this.setPhase("COMPLETED_CYCLE");
  }

  async _collectAll() {
    for (const b of this.state.pendingBets) {
      const r = await this.collectBet(b.betCode);
      const won = r.data?.winingAmount ?? r.data?.winAmount ?? r.data?.amount ?? 0;
      this.state.stats.totalCollected += won;
      if (r.data?.playerBalance != null) { this.state.balance = r.data.playerBalance; this._notifyBalance(); }
      this.log(`💰 +R$${(won / 100).toFixed(2)} – Saldo: R$${(this.state.balance / 100).toFixed(2)}`);
    }
  }
}
