-- SALA LIMPA · o pedaço do Supabase que o bootstrap presume que já existe
--
-- POR QUE ESTE ARQUIVO NÃO É PARTE DO BOOTSTRAP
--
-- `supabase/bootstrap/schema.sql` roda num projeto Supabase de verdade, onde
-- os papéis do PostgREST e o schema `auth` já vêm prontos. Criá-los ali seria
-- mentir sobre o que o projeto controla -- e, num projeto real, daria erro.
--
-- Só que para PROVAR que o bootstrap reconstrói o banco, é preciso rodá-lo em
-- algum lugar. E esse lugar não pode ser produção. Então ele roda num Postgres
-- descartável, e este arquivo é a maquete do Supabase que falta lá: três
-- papéis, um schema `auth`, uma tabela de usuários e a função que diz quem
-- está logado.
--
-- É MAQUETE, NÃO CÓPIA. O `auth` do Supabase tem dezenas de tabelas, triggers
-- e uma máquina de sessão inteira. Aqui há o mínimo de que o schema depende:
-- `auth.users(id)`, para as chaves estrangeiras, e `auth.uid()`, para o RLS.
-- O que este arquivo não reproduz também não é conferido pela comparação.
--
-- NUNCA RODE ISTO EM PRODUÇÃO. Não há nada a ganhar e há um `auth.uid()` a
-- perder.
--
-- Uso:
--   psql -h /tmp/pg-limpo/run -p 54329 -U postgres -d <banco> -f ferramentas/sala-limpa.sql

-- ------------------------------------------------------------------ papéis --
-- `nologin`: ninguém se conecta como eles. O PostgREST troca de papel depois
-- de autenticar, e os testes fazem o mesmo com `set role`.
-- `noinherit` em `authenticated` e `anon` reproduz o Supabase: o papel não
-- herda nada de quem o assume.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end $$;

-- -------------------------------------------------------------------- auth --

create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key,
  email text
);

-- A mesma leitura que o Supabase faz: o `sub` do JWT, que o PostgREST põe num
-- parâmetro de sessão. Nos testes, quem põe é um `set request.jwt.claims`.
-- `true` no `current_setting` devolve nulo em vez de erro quando o parâmetro
-- não existe -- e é assim que um anônimo tem `auth.uid()` nulo, não um erro.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid;
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
