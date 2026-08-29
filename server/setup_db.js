// Script para inicializar as tabelas no Supabase automaticamente
import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const { Client } = pg;

const client = new Client({
  connectionString: process.env.DATABASE_URL,
});

const createTablesSQL = `
-- Tabela de operadores
CREATE TABLE IF NOT EXISTS public.operators (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  username text UNIQUE NOT NULL,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Tabela de contas
CREATE TABLE IF NOT EXISTS public.accounts (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  operator_id uuid REFERENCES public.operators(id),
  player_casino_id text UNIQUE NOT NULL,
  name text NOT NULL,
  cpf text,
  password text,
  sid text NOT NULL,
  balance integer DEFAULT 0,
  status text DEFAULT 'active',
  error_message text,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);
`;

async function setup() {
  try {
    await client.connect();
    console.log("Conectado ao banco de dados!");
    
    await client.query(createTablesSQL);
    console.log("Tabelas criadas com sucesso (se não existissem).");
    
  } catch (err) {
    console.error("Erro ao configurar banco:", err);
  } finally {
    await client.end();
  }
}

setup();
