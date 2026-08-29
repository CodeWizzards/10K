// Reutiliza a sequência e os payloads do bot principal, mas conversa apenas
// com a API fictícia local (/test-api).
import { CrashBot } from './bot.js';

export class TestBot extends CrashBot {
  constructor(account, options = {}) {
    // Cada início recebe uma rodada local nova. Assim o sincronismo sempre
    // percorre RUNNING → OPEN, mesmo depois de parar e iniciar novamente.
    const localSession = `test-session-bot-${account.id}-${Date.now()}`;
    super({ ...account, sid: localSession }, {
      ...options,
      baseUrl: process.env.TEST_API_BASE_URL || `http://127.0.0.1:${process.env.PORT || 3000}/test-api`,
      onBalanceUpdate: null,
      onError: null
    });
    this.isTestMode = true;
  }

  async start() {
    this.log('🧪 Ambiente local iniciado — requisições direcionadas apenas ao simulador.');
    return super.start();
  }
}
