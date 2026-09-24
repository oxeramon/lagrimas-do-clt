-- RLS protege linhas, mas não substitui GRANT. A interface pública só precisa
-- ler ping; todas as escritas e leituras financeiras exigem sessão.
revoke all privileges on all tables in schema public from anon;
grant select on table public.ping to anon;

-- Não há comando TRUNCATE, CREATE TRIGGER ou REFERENCES no cliente.
-- TRUNCATE não passa pelas políticas de linhas; mantenha-o fora dos papéis web.
revoke truncate, trigger, references on all tables in schema public from authenticated;

-- Uma nova tabela criada futuramente precisa de grants explícitos, não de
-- privilégios amplos herdados dos defaults deste projeto.
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke truncate, trigger, references
  on tables from authenticated;

-- Conferência: consultar has_table_privilege para anon/authenticated, testar
-- ping sem sessão e os fluxos de leitura/escrita com sessão de teste.
-- Rollback: restaurar apenas os grants necessários a partir do inventário
-- anterior; não voltar a conceder TRUNCATE aos papéis web.
