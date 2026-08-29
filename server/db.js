// ═══════════════════════════════════════════════════════════════════════════
// CRASH AUDITOR – db.js
// Conectado ao banco de dados Supabase real.
// ═══════════════════════════════════════════════════════════════════════════
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("⚠️ Faltam credenciais do Supabase no .env!");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// ─── Operadores ───────────────────────────────────────────────────────────
export async function getOrCreateOperator(username) {
  let { data: op } = await supabase.from('operators').select('*').eq('username', username).single();
  
  if (!op) {
    const { data: newOp, error } = await supabase.from('operators').insert([{ username }]).select().single();
    if (error) throw error;
    op = newOp;
  }
  return op;
}

export async function getOperator(username) {
  const { data } = await supabase.from('operators').select('*').eq('username', username).single();
  return data;
}

// ─── Contas ───────────────────────────────────────────────────────────────
export async function getAccounts(operatorUsername) {
  if (!operatorUsername) {
    const { data } = await supabase.from('accounts').select('*').order('created_at', { ascending: false });
    return data || [];
  }
  
  const op = await getOperator(operatorUsername);
  if (!op) return [];
  
  const { data } = await supabase.from('accounts').select('*').eq('operator_id', op.id).order('created_at', { ascending: false });
  return data || [];
}

export async function getAccountById(id) {
  const { data } = await supabase.from('accounts').select('*').eq('id', id).single();
  return data;
}

export async function getAccountByPlayerCasinoId(playerCasinoId) {
  const { data } = await supabase.from('accounts').select('*').eq('player_casino_id', playerCasinoId).single();
  return data;
}

// Upsert: se playerCasinoId existe → atualiza SID. Se não → cria novo.
export async function syncAccount({ operatorUsername, playerCasinoId, sid, name }) {
  const op = await getOrCreateOperator(operatorUsername);
  const existing = await getAccountByPlayerCasinoId(playerCasinoId);

  if (existing) {
    // Atualiza SID e reativa
    const updates = {
      sid,
      status: 'active',
      error_message: null,
      updated_at: new Date().toISOString()
    };
    if (name) updates.name = name;
    
    const { data, error } = await supabase.from('accounts').update(updates).eq('id', existing.id).select().single();
    if (error) throw error;
    return { action: 'updated', account: data };
  } else {
    // Cria novo
    const newAcc = {
      operator_id: op.id,
      player_casino_id: playerCasinoId,
      name: name || 'Sem nome',
      cpf: '',
      password: '',
      sid,
      balance: 0,
      status: 'active'
    };
    const { data, error } = await supabase.from('accounts').insert([newAcc]).select().single();
    if (error) throw error;
    return { action: 'created', account: data };
  }
}

export async function updateAccount(id, updates) {
  updates.updated_at = new Date().toISOString();
  
  // Clean up undefined fields
  Object.keys(updates).forEach(key => {
    if (updates[key] === undefined) {
      delete updates[key];
    }
  });

  const { data, error } = await supabase.from('accounts').update(updates).eq('id', id).select().single();
  if (error) {
    console.error("Erro no updateAccount:", error.message);
    return null;
  }
  return data;
}

export async function deleteAccount(id) {
  const { error } = await supabase.from('accounts').delete().eq('id', id);
  if (error) {
    console.error("Erro no deleteAccount:", error.message);
    return false;
  }
  return true;
}

// Atualiza saldo de uma conta
export async function updateBalance(id, balance) {
  return updateAccount(id, { balance });
}

// Marca conta com erro
export async function setAccountError(id, errorMessage) {
  return updateAccount(id, { status: 'error', error_message: errorMessage });
}

// Reativa conta
export async function reactivateAccount(id, newSid) {
  return updateAccount(id, { sid: newSid, status: 'active', error_message: null });
}
