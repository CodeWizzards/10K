// ═══════════════════════════════════════════════════════════════════════════
// CRASH AUDITOR – manager.js v4
// Gerencia bots, persiste no db.js, broadcast SSE.
// ═══════════════════════════════════════════════════════════════════════════
import * as db from './db.js';
import { CrashBot } from './bot.js';
import { TestBot } from './test-bot.js';
import { readFile, writeFile } from 'node:fs/promises';

const MAX_LOG = 500;
const settingsFile = new URL('./.runtime-settings.json', import.meta.url);
const DEMO_TEST_ACCOUNT_ID = 'demo-test-account';

function createDemoTestAccount() {
  return {
    id: DEMO_TEST_ACCOUNT_ID,
    name: 'Conta de exemplo — Modo teste',
    cpf: '000.000.000-00',
    password: '',
    player_casino_id: 'simulador-local',
    sid: '',
    balance: 100000,
    status: 'active',
    isTestAccount: true
  };
}

export class BotManager {
  constructor() {
    this.bots = new Map();       // accountId → CrashBot
    this.logs = [];
    this.sseClients = new Set();
    this.mode = 'duplicate';     // global mode: 'duplicate' ou 'target'
    this.target = null;          // global target multiplier
    this.isTestMode = false;
    this.testAccounts = new Map();
    this.showDemoTestAccount = true;
  }

  async initialize() {
    try {
      const settings = JSON.parse(await readFile(settingsFile, 'utf8'));
      this.isTestMode = settings.isTestMode === true;
    } catch {
      this.isTestMode = false;
    }
  }

  async setTestMode(enabled) {
    const next = enabled === true;
    if (this.isTestMode !== next) {
      // Nunca permita que um bot criado num modo continue rodando no outro.
      await this.stopAll();
      this.isTestMode = next;
      if (next) this.showDemoTestAccount = true;
    }
    // A preferência é local ao servidor: não depende da aba estar aberta nem do
    // navegador ficar em primeiro plano.
    await writeFile(settingsFile, JSON.stringify({ isTestMode: this.isTestMode }, null, 2));
    this._broadcast({ type: 'test_mode', enabled: this.isTestMode, timestamp: Date.now() });
    this._pushLog('system', 'Sistema', this.isTestMode
      ? '🧪 Modo teste ativado. Todas as execuções agora são simuladas localmente.'
      : 'Modo teste desativado. Nenhuma execução foi reiniciada automaticamente.', { phase: 'SYSTEM' });
    return this.isTestMode;
  }

  registerTestAccount({ playerCasinoId, sid, name }) {
    const id = `test-capture-${String(playerCasinoId).replace(/[^a-zA-Z0-9_-]/g, '_')}`;
    const account = { id, name: name || 'Conta capturada no ambiente de teste', cpf: '000.000.000-00', password: '', player_casino_id: playerCasinoId, sid, balance: 100000, status: 'active', isTestAccount: true };
    this.testAccounts.set(id, account);
    this._broadcast({ type: 'account_sync', action: 'test_created', account, timestamp: Date.now() });
    return account;
  }

  removeTestAccount(accountId) {
    const bot = this.bots.get(accountId);
    if (bot?.isRunning) bot.stop();
    this.bots.delete(accountId);
    if (accountId === DEMO_TEST_ACCOUNT_ID) {
      this.showDemoTestAccount = false;
      return true;
    }
    return this.testAccounts.delete(accountId);
  }

  // ─── SSE ────────────────────────────────────────────────────────────
  _broadcast(entry) {
    const payload = JSON.stringify(entry);
    for (const res of this.sseClients) {
      try { res.write(`data: ${payload}\n\n`); } catch { this.sseClients.delete(res); }
    }
  }

  _pushLog(accountId, accountName, message, data) {
    const entry = {
      type: 'log',
      accountId, account: accountName, message,
      phase: data?.phase, balance: data?.balance, stats: data?.stats,
      timestamp: Date.now()
    };
    this.logs.unshift(entry);
    if (this.logs.length > MAX_LOG) this.logs.length = MAX_LOG;
    this._broadcast(entry);
  }

  addSSEClient(res) {
    this.sseClients.add(res);
    res.on('close', () => this.sseClients.delete(res));
  }

  // ─── Bot lifecycle ──────────────────────────────────────────────────
  async startBot(accountId) {
    const testAccount = this.isTestMode ? this.testAccounts.get(accountId) : null;
    const isVirtualTestAccount = this.isTestMode && (accountId === DEMO_TEST_ACCOUNT_ID || Boolean(testAccount));
    const acc = accountId === DEMO_TEST_ACCOUNT_ID ? createDemoTestAccount() : (testAccount || await db.getAccountById(accountId));
    if (!acc) return { ok: false, error: "Conta não encontrada" };
    // No modo teste não existe sessão real: uma conta fictícia pode iniciar
    // sem SID e continuará totalmente isolada da plataforma externa.
    if (!this.isTestMode && (!acc.sid || acc.sid.length < 10)) {
      return { ok: false, error: "SID inválida" };
    }

    // Para bot existente se houver
    if (this.bots.has(accountId)) {
      const old = this.bots.get(accountId);
      if (old.isRunning) old.stop();
    }

    const BotClass = this.isTestMode ? TestBot : CrashBot;
    const bot = new BotClass(acc, {
      mode: this.mode,
      target: this.mode === 'target' ? this.target : null,
      onLog: (id, name, msg, data) => this._pushLog(id, name, msg, data),
      onError: async (id, errorMsg) => {
        await db.setAccountError(id, errorMsg);
        this._broadcast({ type: 'account_error', accountId: id, error: errorMsg, timestamp: Date.now() });
      },
      // Dados simulados nunca são gravados no saldo real da conta.
      onBalanceUpdate: this.isTestMode ? null : async (id, balance) => {
        await db.updateBalance(id, balance);
      }
    });

    this.bots.set(accountId, bot);
    if (!isVirtualTestAccount) await db.updateAccount(accountId, { status: 'running' });

    bot.start().catch(err => {
      this._pushLog(accountId, acc.name, `❌ Fatal: ${err.message}`, { phase: "ERROR" });
    });

    return { ok: true };
  }

  async stopBot(accountId) {
    const bot = this.bots.get(accountId);
    if (!bot) return { ok: false, error: "Bot não encontrado" };
    bot.stop();
    if (accountId !== DEMO_TEST_ACCOUNT_ID && !this.testAccounts.has(accountId)) await db.updateAccount(accountId, { status: 'active' });
    return { ok: true };
  }

  // ─── Batch ──────────────────────────────────────────────────────────
  async startBatch(accountIds) {
    const results = [];
    for (const id of accountIds) {
      const r = await this.startBot(id);
      results.push({ id, ...r });
      await new Promise(r => setTimeout(r, 300)); // stagger
    }
    return results;
  }

  async stopBatch(accountIds) {
    const results = [];
    for (const id of accountIds) {
      const r = await this.stopBot(id);
      results.push({ id, ...r });
    }
    return results;
  }

  async stopAll() {
    for (const [id, bot] of this.bots) {
      if (bot.isRunning) bot.stop();
    }
    // Atualiza status de todas
    try {
      const accs = await db.getAccounts();
      for (const acc of accs) {
        if (acc.status === 'running') await db.updateAccount(acc.id, { status: 'active' });
      }
    } catch (err) {
      // Parar os bots vem antes do banco. Uma falha temporária de banco nunca
      // pode deixar uma execução real ativa ao trocar de modo.
      this._pushLog('system', 'Sistema', `⚠️ Execuções paradas, mas o status no banco não pôde ser atualizado: ${err.message}`, { phase: 'SYSTEM' });
    }
  }

  // ─── Mode ───────────────────────────────────────────────────────────
  setMode(mode, target) {
    this.mode = mode;
    this.target = target;
    // Atualiza bots ativos com novo modo/target
    for (const bot of this.bots.values()) {
      if (bot.isRunning) {
        bot.mode = mode;
        bot.targetMultiplier = mode === 'target' ? target : null;
      }
    }
  }

  // ─── Status ─────────────────────────────────────────────────────────
  async getAllStatus(operatorUsername) {
    const storedAccounts = await db.getAccounts(operatorUsername);
    // A conta demonstrativa só existe em memória e só é exposta no modo teste.
    const accounts = this.isTestMode
      ? [...(this.showDemoTestAccount ? [createDemoTestAccount()] : []), ...this.testAccounts.values(), ...storedAccounts.filter(acc => acc.id !== DEMO_TEST_ACCOUNT_ID)]
      : storedAccounts;
    return accounts.map(acc => {
      const bot = this.bots.get(acc.id);
      const isRunning = bot?.isRunning || false;
      return {
        ...acc,
        sid_display: acc.sid ? acc.sid.slice(0, 8) + "…" + acc.sid.slice(-4) : null,
        phase: bot?.state?.phase || (acc.status === 'running' ? 'RUNNING' : 'IDLE'),
        isRunning,
        botStats: bot?.state?.stats || null,
        liveBalance: bot?.state?.balance ?? acc.balance
      };
    });
  }

  async getGlobalStats(operatorUsername) {
    const storedAccounts = await db.getAccounts(operatorUsername);
    const accounts = this.isTestMode
      ? [...(this.showDemoTestAccount ? [createDemoTestAccount()] : []), ...this.testAccounts.values(), ...storedAccounts.filter(acc => acc.id !== DEMO_TEST_ACCOUNT_ID)]
      : storedAccounts;
    let totalBalance = 0, activeBots = 0, totalAccounts = accounts.length;
    let totalProfit = 0, totalCycles = 0;

    for (const acc of accounts) {
      const bot = this.bots.get(acc.id);
      totalBalance += bot?.state?.balance ?? acc.balance;
      if (bot?.isRunning) {
        activeBots++;
        totalProfit += bot.state.stats.profit;
        totalCycles += bot.state.stats.cycles;
      }
    }
    return { totalBalance, activeBots, totalAccounts, totalProfit, totalCycles, mode: this.mode, target: this.target, isTestMode: this.isTestMode };
  }
}
