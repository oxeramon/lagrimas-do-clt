-- =====================================================================
-- 016 · A REGRA DE ALOCAÇÃO: reservar X por mês, uma vez só
-- =====================================================================
-- As migrações 001..015 são IMUTÁVEIS: nada aqui edita nenhuma delas.
--
-- PRÉ-CONDIÇÃO conferida antes de aplicar: `metas` e `alocacoes_de_meta`
-- vazias, nenhuma das colunas novas existindo, nenhuma função com "regra" no
-- nome. As contagens estão na seção 6.
--
-- O contrato está em `docs/CONTRATO_SOBRA.md`, seção "Alocação recorrente", e
-- o de Metas continua valendo inteiro: reservar NÃO é movimento, NÃO cria
-- transação e NÃO mexe em saldo de conta.
--
-- ---------------------------------------------------------------------
-- POR QUE ISTO PRECISA DE BANCO
-- ---------------------------------------------------------------------
-- Duas coisas não se derivam, e é por isso que viram coluna:
--
-- 1. A REGRA. "reservar 500 por mês" é uma decisão da pessoa. Não há como
--    calculá-la a partir de nada.
--
-- 2. DE QUE MÊS é uma alocação automática. `data` não serve: a pessoa pode
--    reservar à mão duas vezes no mesmo mês, legitimamente, e sem saber qual
--    linha veio da regra não há como rodar a regra de novo sem duplicar.
--
-- O resto se calcula e NÃO vira coluna. Em especial "quanto faltou para
-- completar a regra": é a subtração entre o valor da regra e o que foi
-- alocado naquela competência, e este projeto não guarda subtração.
--
-- ---------------------------------------------------------------------
-- A IDEMPOTÊNCIA É DO BANCO, NÃO DA TELA
-- ---------------------------------------------------------------------
-- Um índice único parcial garante UMA alocação de regra por meta por
-- competência. Parcial porque alocação MANUAL não tem esse limite: reservar à
-- mão duas vezes no mesmo mês é uma coisa que a pessoa tem o direito de fazer.
--
-- Fosse um `if` na tela, dois cliques rápidos criariam duas linhas -- e o
-- segundo clique é exatamente o que acontece quando a primeira resposta
-- demora.


-- ---------------------------------------------------------------------
-- 1. A REGRA, EM `metas`
-- ---------------------------------------------------------------------
-- `regra_ativa` separada de `regra_valor` para a pessoa poder desligar sem
-- perder o valor que tinha escolhido. Desligar e voltar não deve custar
-- redigitar.

alter table public.metas add column if not exists regra_valor numeric(14,2);
alter table public.metas add column if not exists regra_ativa boolean not null default false;

alter table public.metas drop constraint if exists metas_regra_valor_check;
alter table public.metas add  constraint metas_regra_valor_check
  check (regra_valor is null or regra_valor > 0);

-- Regra ligada sem valor é um estado que não quer dizer nada, e a tela não
-- teria o que fazer com ele.
alter table public.metas drop constraint if exists regra_ativa_tem_valor;
alter table public.metas add  constraint regra_ativa_tem_valor
  check (not regra_ativa or regra_valor is not null);


-- ---------------------------------------------------------------------
-- 2. DE ONDE VEIO E DE QUE MÊS, EM `alocacoes_de_meta`
-- ---------------------------------------------------------------------

alter table public.alocacoes_de_meta add column if not exists origem text not null default 'manual';
alter table public.alocacoes_de_meta add column if not exists competencia text;

alter table public.alocacoes_de_meta drop constraint if exists alocacoes_origem_check;
alter table public.alocacoes_de_meta add  constraint alocacoes_origem_check
  check (origem in ('manual', 'regra'));

alter table public.alocacoes_de_meta drop constraint if exists alocacoes_competencia_formato;
alter table public.alocacoes_de_meta add  constraint alocacoes_competencia_formato
  check (competencia is null or competencia ~ '^\d{4}-(0[1-9]|1[0-2])$');

-- Alocação de regra sem competência não pode existir: é a competência que
-- torna a regra idempotente, e sem ela o índice único abaixo não a alcança.
alter table public.alocacoes_de_meta drop constraint if exists regra_tem_competencia;
alter table public.alocacoes_de_meta add  constraint regra_tem_competencia
  check (origem <> 'regra' or competencia is not null);

-- O ÍNDICE QUE FAZ A COISA TODA FUNCIONAR. Parcial: só alcança o que veio da
-- regra. Reservar à mão duas vezes no mesmo mês continua permitido.
create unique index if not exists alocacao_da_regra_uma_por_competencia
  on public.alocacoes_de_meta (user_id, meta_id, competencia)
  where origem = 'regra';

comment on column public.alocacoes_de_meta.origem is
  'manual (a pessoa reservou) ou regra (veio da regra mensal). Só regra entra no índice único por competência.';
comment on column public.alocacoes_de_meta.competencia is
  'AAAA-MM de qual mês a alocação de regra pertence. Nulo em alocação manual: ela não tem mês próprio, tem data.';


-- ---------------------------------------------------------------------
-- 3. A VIEW PASSA A CONTAR A REGRA
-- ---------------------------------------------------------------------
-- Colunas acrescentadas NO FIM: `create or replace view` exige que o começo
-- da lista não mude.

create or replace view public.metas_resolvidas
with (security_invoker = true) as
  select m.id as meta_id,
         m.user_id,
         m.nome,
         m.valor_alvo,
         m.prazo,
         m.prioridade,
         m.cor,
         m.icone,
         m.status,
         m.obs,
         m.ordem,
         m.criado_em,
         coalesce(a.reservado, 0)::numeric(14,2) as reservado,
         greatest(m.valor_alvo - coalesce(a.reservado, 0), 0)::numeric(14,2) as falta,
         coalesce(a.quantas, 0) as alocacoes,
         least(round(coalesce(a.reservado, 0) * 100 / m.valor_alvo), 100)::integer as percentual,
         case
           when m.prazo is null then null::integer
           else greatest(1, (date_part('year', age(m.prazo::timestamptz, current_date::timestamptz)) * 12
                             + date_part('month', age(m.prazo::timestamptz, current_date::timestamptz)))::integer + 1)
         end as meses_ate_prazo,
         m.regra_valor,
         m.regra_ativa
    from public.metas m
    left join lateral (
      select sum(x.valor) as reservado,
             count(*) as quantas
        from public.alocacoes_de_meta x
       where x.meta_id = m.id and x.user_id = m.user_id) a on true;


-- ---------------------------------------------------------------------
-- 4. APLICAR A REGRA
-- ---------------------------------------------------------------------
-- Devolve TRÊS coisas porque "não alocou" tem duas causas diferentes, e
-- confundi-las deixaria a tela sem o que dizer:
--
--   alocado       quanto entrou AGORA (zero se já tinha entrado, ou se não há
--                 dinheiro)
--   ja_aplicada   a regra deste mês já tinha rodado
--   disponivel    quanto havia livre e não prometido na hora da conta
--
-- QUANDO NÃO DÁ PARA RESERVAR O VALOR INTEIRO, reserva o que couber. Não o
-- valor cheio, que o banco recusaria e seria mentira; nem zero, que perderia
-- o mês inteiro por causa do que faltou. A meta anda o que dá para andar.
--
-- Com disponível zero ou negativo NÃO cria linha nenhuma: alocação de zero não
-- é informação, é ruído no histórico.

create or replace function public.aplica_regra_de_meta(
  p_meta uuid,
  p_competencia text,
  out alocado numeric,
  out ja_aplicada boolean,
  out disponivel numeric)
returns record
language plpgsql
set search_path to 'public'
as $fn$
declare
  m public.metas%rowtype;
  quanto numeric(14,2);
begin
  if auth.uid() is null then
    raise exception 'meta: é preciso estar logado';
  end if;
  if p_competencia !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'meta: a competência precisa estar no formato AAAA-MM';
  end if;

  -- o RLS responde "é minha?" sozinho: meta de outra pessoa não é encontrada
  select * into m from public.metas where id = p_meta;
  if m.id is null then
    raise exception 'meta: não encontrada';
  end if;
  if not m.regra_ativa then
    raise exception 'meta: esta meta não tem regra mensal ligada';
  end if;
  if m.status <> 'ativa' then
    raise exception 'meta: só meta ativa reserva por regra';
  end if;

  alocado := 0;
  ja_aplicada := exists (
    select 1 from public.alocacoes_de_meta
     where meta_id = p_meta and competencia = p_competencia and origem = 'regra');

  -- o que há de livre e ainda não prometido. As duas funções já leem sob RLS
  disponivel := public.saldo_livre_do_usuario() - public.total_reservado_em_metas();

  if ja_aplicada then return; end if;
  if disponivel is null or disponivel <= 0 then return; end if;

  quanto := least(m.regra_valor, disponivel);
  -- não passa do que ainda falta para a meta: reservar além do alvo prometeria
  -- dinheiro a um objetivo que já foi alcançado
  quanto := least(quanto, greatest(0, m.valor_alvo - coalesce((
    select sum(valor) from public.alocacoes_de_meta where meta_id = p_meta), 0)));
  if quanto <= 0 then return; end if;

  insert into public.alocacoes_de_meta (meta_id, valor, data, competencia, origem, obs)
  values (p_meta, quanto, public.dia_no_mes(p_competencia, 1), p_competencia, 'regra',
          'Regra mensal')
  on conflict do nothing;

  alocado := quanto;
end $fn$;


-- ---------------------------------------------------------------------
-- 5. DESFAZER A REGRA DE UM MÊS
-- ---------------------------------------------------------------------
-- Sem isto a regra seria idempotente E irreversível, que juntas viram uma
-- armadilha: aplicou errado, não dá para aplicar de novo nem para tirar.
--
-- Apaga a linha em vez de lançar uma negativa de propósito: a alocação de
-- regra é uma marca de "este mês já rodou", e uma negativa deixaria a marca no
-- lugar. Alocação MANUAL continua se desfazendo com valor negativo, que é o
-- que preserva o histórico de uma decisão.

create or replace function public.desfaz_regra_de_meta(p_meta uuid, p_competencia text)
returns boolean
language plpgsql
set search_path to 'public'
as $fn$
declare apagadas int;
begin
  if auth.uid() is null then
    raise exception 'meta: é preciso estar logado';
  end if;

  delete from public.alocacoes_de_meta
   where meta_id = p_meta and competencia = p_competencia and origem = 'regra';
  get diagnostics apagadas = row_count;
  return apagadas > 0;
end $fn$;


-- ---------------------------------------------------------------------
-- 6. PERMISSÕES
-- ---------------------------------------------------------------------
-- O DEFEITO DA 012 MORAVA AQUI: função nova no Supabase nasce com `execute`
-- para `anon`, e `revoke ... from public` NÃO tira concessão explícita de
-- papel. Por isso o revoke nomeia os papéis, um a um, antes de conceder.

revoke all on function public.aplica_regra_de_meta(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.aplica_regra_de_meta(uuid, text) to authenticated, service_role;

revoke all on function public.desfaz_regra_de_meta(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.desfaz_regra_de_meta(uuid, text) to authenticated, service_role;


-- ---------------------------------------------------------------------
-- 7. PRÉ-CONDIÇÃO E CONFERÊNCIA
-- ---------------------------------------------------------------------
-- ANTES de aplicar (só `select`, não muda nada):
--
--   select count(*) from public.metas;                        -- era 0
--   select count(*) from public.alocacoes_de_meta;            -- era 0
--   select count(*) from pg_attribute a join pg_class c on c.oid=a.attrelid
--     join pg_namespace n on n.oid=c.relnamespace
--    where n.nspname='public' and c.relname='metas'
--      and a.attname in ('regra_valor','regra_ativa');         -- era 0
--
-- Com tabela vazia, `add column not null default false` não reescreve nada e
-- não pode falhar por dado existente. Em base com linhas o default cobre as
-- antigas, e o resultado é o mesmo -- mas a conferência acima é o que permite
-- afirmar isso em vez de supor.
--
-- DEPOIS de aplicar:
--
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--    where conname in ('metas_regra_valor_check','regra_ativa_tem_valor',
--                      'alocacoes_origem_check','alocacoes_competencia_formato',
--                      'regra_tem_competencia');                -- 5 linhas
--
--   select indexdef from pg_indexes
--    where indexname = 'alocacao_da_regra_uma_por_competencia'; -- 1, parcial
--
--   select p.proname, has_function_privilege('anon', p.oid, 'execute')
--     from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--    where n.nspname='public' and p.proname like '%regra_de_meta';
--                                          -- 2 linhas, as duas com false
--
--   select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
--    where n.nspname='public' and c.relkind='v';                -- continua 6
--
-- As contagens de linha de todas as 24 tabelas precisam ser as mesmas de
-- antes: esta migração não move dado.
--
-- ---------------------------------------------------------------------
-- 8. ROLLBACK
-- ---------------------------------------------------------------------
-- Reversível, com uma ressalva: apagar as colunas apaga as regras que a pessoa
-- tiver configurado. As alocações já feitas continuam -- elas são dinheiro
-- prometido, e não configuração.
--
--   drop function if exists public.desfaz_regra_de_meta(uuid, text);
--   drop function if exists public.aplica_regra_de_meta(uuid, text);
--   drop index if exists public.alocacao_da_regra_uma_por_competencia;
--   alter table public.alocacoes_de_meta drop constraint if exists regra_tem_competencia;
--   alter table public.alocacoes_de_meta drop constraint if exists alocacoes_competencia_formato;
--   alter table public.alocacoes_de_meta drop constraint if exists alocacoes_origem_check;
--   alter table public.alocacoes_de_meta drop column if exists competencia;
--   alter table public.alocacoes_de_meta drop column if exists origem;
--   alter table public.metas drop constraint if exists regra_ativa_tem_valor;
--   alter table public.metas drop constraint if exists metas_regra_valor_check;
--   alter table public.metas drop column if exists regra_ativa;
--   alter table public.metas drop column if exists regra_valor;
--   -- e recriar `metas_resolvidas` sem as duas colunas finais, como na 014
