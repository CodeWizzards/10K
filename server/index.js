// ═══════════════════════════════════════════════════════════════════════════
// CRASH AUDITOR – index.js v4
// Express + API REST + SSE + Extensão sync endpoint.
// ═══════════════════════════════════════════════════════════════════════════
import 'express-async-errors';
import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { BotManager } from './manager.js';
import * as db from './db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

// CORS aberto para a extensão poder fazer POST
app.use((_req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (_req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

const manager = new BotManager();
const testSessions = new Map();

function getTestSession(sid) {
  const key = String(sid || 'test-session-anon');
  if (!testSessions.has(key)) testSessions.set(key, { balance: 100000, syncReads: 0, pendingBets: new Map(), afterCollect: false, multiplier: 1.1 });
  return testSessions.get(key);
}

// ─── EXTENSÃO: Sync endpoint ─────────────────────────────────────────────
// A extensão manda: { operator, playerCasinoId, sid, name }
app.post('/api/sync', async (req, res) => {
  const { operator, playerCasinoId, sid, name } = req.body;
  if (!operator || !playerCasinoId || !sid) {
    return res.status(400).json({ ok: false, error: "Campos obrigatórios: operator, playerCasinoId, sid" });
  }
  try {
    if (manager.isTestMode && String(playerCasinoId).startsWith('test-') && String(sid).startsWith('test-session-')) {
      const account = manager.registerTestAccount({ playerCasinoId, sid, name });
      return res.json({ ok: true, action: 'test_created', account });
    }
    const result = await db.syncAccount({ operatorUsername: operator, playerCasinoId, sid, name });
    console.log(`🔄 Sync: ${result.action} – ${result.account.name} (${playerCasinoId.slice(0, 8)}…)`);
    // Broadcast para dashboard
    manager._broadcast({ type: 'account_sync', action: result.action, account: result.account, timestamp: Date.now() });
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Ambiente fictício: mesmas rotas e estrutura de payload usadas pelo bot.
app.post('/test-api/game/getCurrentRoundInfo', (req, res) => {
  const session = getTestSession(req.body?.sid);
  session.syncReads += 1;
  let status = 'OPEN';
  if (session.syncReads <= 2) status = 'RUNNING';
  else if (session.pendingBets.size) {
    status = 'RUNNING';
    // O laboratório é sem risco: o multiplicador sempre progride até o
    // alvo selecionado, inclusive quando ele for maior que 3x.
    session.multiplier = Number((session.multiplier + 0.6).toFixed(2));
  } else if (session.afterCollect) {
    session.afterCollect = false;
    session.multiplier = 1.1;
  }
  res.json({ status, balance: session.balance, multiplier: session.multiplier, currentMultiplier: session.multiplier, canCollect: session.pendingBets.size > 0 });
});

app.post('/test-api/game/bet', (req, res) => {
  const session = getTestSession(req.body?.sid);
  const amount = Math.max(0, Math.round(Number(req.body?.am || 0) * 100));
  if (!amount || amount > session.balance) return res.status(400).json({ error: 'Saldo simulado insuficiente' });
  const betCode = `test-bet-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  session.pendingBets.set(betCode, amount);
  // Aposta fictícia: registramos a operação, mas não descontamos saldo.
  // Assim, parar um teste no meio de uma rodada nunca zera o valor exibido.
  res.json({ betCode, playerBalance: session.balance });
});

app.post('/test-api/game/cancelBet', (req, res) => {
  const session = getTestSession(req.body?.sid);
  res.json({ ok: true, playerBalance: session.balance, simulated: true });
});

app.post('/test-api/game/collectBet', (req, res) => {
  const session = getTestSession(req.body?.sid);
  const amount = session.pendingBets.get(req.body?.betCode) || 0;
  const winingAmount = Math.round(amount * 1.1);
  session.pendingBets.delete(req.body?.betCode);
  // Como a aposta não foi debitada no laboratório, soma-se somente o lucro.
  session.balance += Math.round(amount * 0.1);
  if (!session.pendingBets.size) session.afterCollect = true;
  res.json({ winingAmount, playerBalance: session.balance, simulated: true });
});

app.get('/test-site/launcher', (_req, res) => {
  const nonce = crypto.randomUUID();
  res.set('Cache-Control', 'no-store');
  res.json({
    playerCasinoId: `test-player-${nonce.slice(0, 12)}`,
    sid: `test-session-${nonce}`,
    playerName: `Conta capturada — Teste ${nonce.slice(0, 4).toUpperCase()}`
  });
});

app.get('/test-site', (_req, res) => res.sendFile(join(__dirname, 'public', 'test-site.html')));

// ─── API: Contas ──────────────────────────────────────────────────────────
app.get('/api/accounts', async (req, res) => {
  const operator = req.query.operator || null;
  const accounts = await manager.getAllStatus(operator);
  res.json({ ok: true, accounts });
});

app.patch('/api/accounts/:id', async (req, res) => {
  const result = await db.updateAccount(req.params.id, req.body);
  if (!result) return res.status(404).json({ ok: false, error: "Conta não encontrada" });
  res.json({ ok: true, account: result });
});

app.delete('/api/accounts/:id', async (req, res) => {
  if (manager.isTestMode && manager.removeTestAccount(req.params.id)) {
    return res.json({ ok: true, simulated: true });
  }
  // Para bot se ativo
  const bot = manager.bots.get(req.params.id);
  if (bot?.isRunning) bot.stop();
  manager.bots.delete(req.params.id);

  const ok = await db.deleteAccount(req.params.id);
  res.json({ ok });
});

// Adicionar conta manualmente
app.post('/api/accounts', async (req, res) => {
  const { operator, name, sid, cpf, password, playerCasinoId } = req.body;
  if (!operator || !name) return res.status(400).json({ ok: false, error: "operator e name obrigatórios" });
  const result = await db.syncAccount({
    operatorUsername: operator,
    playerCasinoId: playerCasinoId || `manual-${Date.now()}`,
    sid: sid || '',
    name
  });
  if (cpf || password) {
    await db.updateAccount(result.account.id, { cpf, password });
  }
  res.json({ ok: true, account: result.account });
});

// ─── API: Bot control ─────────────────────────────────────────────────────
app.post('/api/accounts/:id/start', async (req, res) => {
  const result = await manager.startBot(req.params.id);
  res.json(result);
});

app.post('/api/accounts/:id/stop', async (req, res) => {
  const result = await manager.stopBot(req.params.id);
  res.json(result);
});

// Batch start/stop
app.post('/api/batch/start', async (req, res) => {
  const { ids } = req.body;
  if (!ids?.length) return res.status(400).json({ ok: false, error: "ids obrigatório" });
  const results = await manager.startBatch(ids);
  res.json({ ok: true, results });
});

app.post('/api/batch/stop', async (req, res) => {
  const { ids } = req.body;
  if (ids?.length) {
    const results = await manager.stopBatch(ids);
    res.json({ ok: true, results });
  } else {
    await manager.stopAll();
    res.json({ ok: true });
  }
});

// ─── Mode & Test Mode ─────────────────────────────────────────────────────
app.post('/api/mode', (req, res) => {
  const { mode, target } = req.body;
  if (!['duplicate', 'target'].includes(mode)) {
    return res.status(400).json({ ok: false, error: "Modo inválido" });
  }
  manager.setMode(mode, target);
  res.json({ ok: true, mode, target });
});

app.post('/api/testmode', async (req, res) => {
  try {
    const isTestMode = await manager.setTestMode(req.body?.enabled === true);
    res.json({ ok: true, isTestMode });
  } catch (err) {
    console.error('Erro ao salvar modo teste:', err);
    res.status(500).json({ ok: false, error: 'Não foi possível salvar o modo teste.' });
  }
});

// ─── Stats ────────────────────────────────────────────────────────────────
app.get('/api/stats', async (req, res) => {
  const operator = req.query.operator || null;
  const stats = await manager.getGlobalStats(operator);
  res.json({ ok: true, stats, isTestMode: manager.isTestMode });
});

// ─── SSE ──────────────────────────────────────────────────────────────────
app.get('/api/logs/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.write('\n');
  manager.addSSEClient(res);
  // Histórico
  for (const entry of manager.logs.slice(0, 50).reverse()) {
    res.write(`data: ${JSON.stringify(entry)}\n\n`);
  }
});

app.get('/api/logs', (_req, res) => {
  res.json({ ok: true, logs: manager.logs.slice(0, 100) });
});

// ─── Serve frontend ───────────────────────────────────────────────────────
app.get('*', (_req, res) => {
  res.sendFile(join(__dirname, 'public', 'index.html'));
});

// ─── Global Error Handler ─────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ ok: false, error: err.message || "Internal Server Error" });
});

// ─── Start ────────────────────────────────────────────────────────────────
async function main() {
  console.log("╔═══════════════════════════════════════╗");
  console.log("║   CRASH AUDITOR – Server v4           ║");
  console.log("╚═══════════════════════════════════════╝\n");

  await manager.initialize();
  console.log(`🧪 Modo teste restaurado: ${manager.isTestMode ? 'ativo' : 'desativado'}`);

  app.listen(PORT, () => {
    console.log(`🌐 Dashboard: http://localhost:${PORT}`);
    console.log(`📡 API:       http://localhost:${PORT}/api`);
    console.log(`🔌 Sync ext:  POST http://localhost:${PORT}/api/sync\n`);
  });
}

main();
