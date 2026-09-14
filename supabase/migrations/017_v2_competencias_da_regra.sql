-- =====================================================================
-- 017 · COMPETÊNCIAS DA REGRA: a atual roda sozinha, as passadas esperam
-- =====================================================================
-- As migrações 001..016 são IMUTÁVEIS: nada aqui edita nenhuma delas. As
-- duas funções da 016 são REDEFINIDAS por `create or replace`, que é coisa
-- diferente -- o arquivo da 016 continua sendo o registro do que ela fez, e
-- este é o registro do que mudou depois. Mesmo caminho da 003 e da 013.
--
-- O contrato está em `docs/CONTRATO_COMPETENCIAS.md`, escrito antes deste
-- arquivo. O de Metas continua valendo inteiro por baixo: reservar NÃO é
-- movimento, NÃO cria transação e NÃO mexe em saldo de conta.
--
-- PRÉ-FLIGHT conferido antes de aplicar, só leitura:
--   metas.regra_desde                      não existe        0
--   alocacoes_de_meta.valor_planejado      não existe        0
--   competencias_de_regra                  não existe        0
--   funções novas                          não existem       0
--   regras ativas hoje                                       0
--   alocações de regra hoje                                  0
--   índice único parcial da 016            existe            1
-- Nenhuma linha a converter: a migração não conserta dado, ela passa a
-- recusar dado errado.
--
-- ---------------------------------------------------------------------
-- O QUE PRECISA DE BANCO, E O QUE NÃO PRECISA
-- ---------------------------------------------------------------------
-- Quatro coisas não se derivam. Só elas viram estado:
--
-- 1. A DECISÃO DE IGNORAR. Ninguém deduz um "não quero" a partir da
--    ausência de dados. Sem tabela, ignorar seria indistinguível de
--    esquecer, e a competência voltaria a cobrar para sempre.
--
-- 2. QUANTO A REGRA PEDIA NO INSTANTE DA APLICAÇÃO. Sem isto, mudar a
--    regra de 500 para 700 faria o histórico de janeiro afirmar que
--    planejava 700 e que faltaram 400. Não é cálculo guardado: é o
--    CONTEXTO de uma decisão, que é fato do passado.
--
-- 3. A PRIMEIRA COMPETÊNCIA DA VIGÊNCIA. Uma regra criada em março não
--    pode gerar pendência de janeiro, e não há de onde deduzir isso --
--    `metas.criado_em` é da meta, não da regra.
--
-- O que NÃO vira coluna, porque se deriva:
--   "aplicada"            existe alocação de regra naquela competência
--   "pendente"            vigência cobre o mês, não é futuro, sem decisão
--   "faltou"              valor_planejado menos valor  (a lição da 016)
--   "sem disponibilidade" é pendente E o disponível de AGORA é <= 0
--
-- E "nunca avaliada" NÃO é um estado separado de "pendente", de propósito:
-- as duas pedem a mesma coisa da pessoa, e um estado a mais que não muda
-- nenhuma ação só pode discordar dos outros.


-- ---------------------------------------------------------------------
-- 1. A VIGÊNCIA DA REGRA, EM `metas`
-- ---------------------------------------------------------------------

alter table public.metas add column if not exists regra_desde text;

alter table public.metas drop constraint if exists regra_desde_formato;
alter table public.metas add  constraint regra_desde_formato
  check (regra_desde is null or regra_desde ~ '^\d{4}-(0[1-9]|1[0-2])$');

-- Regra ligada sem vigência não tem como responder "de que mês em diante?",
-- e a tela derivaria pendência do nada. O par anda junto, como `regra_ativa`
-- e `regra_valor` já andam desde a 016.
alter table public.metas drop constraint if exists regra_ativa_tem_desde;
alter table public.metas add  constraint regra_ativa_tem_desde
  check (not regra_ativa or regra_desde is not null);


-- ---------------------------------------------------------------------
-- 2. O VALOR PLANEJADO, EM `alocacoes_de_meta`
-- ---------------------------------------------------------------------
-- Só faz sentido em alocação de regra: alocação manual não tem "planejado",
-- tem um valor que a pessoa escolheu na hora.

alter table public.alocacoes_de_meta add column if not exists valor_planejado numeric(14,2);

alter table public.alocacoes_de_meta drop constraint if exists valor_planejado_positivo;
alter table public.alocacoes_de_meta add  constraint valor_planejado_positivo
  check (valor_planejado is null or valor_planejado > 0);

-- Manual NUNCA tem planejado. Sem esta metade, uma alocação manual com
-- planejado preenchido apareceria no histórico como se viesse da regra.
alter table public.alocacoes_de_meta drop constraint if exists manual_nao_tem_planejado;
alter table public.alocacoes_de_meta add  constraint manual_nao_tem_planejado
  check (origem = 'regra' or valor_planejado is null);


-- ---------------------------------------------------------------------
-- 3. A DECISÃO DE IGNORAR
-- ---------------------------------------------------------------------
-- Uma linha por (meta, competência) decidida. Hoje o `check` admite um
-- valor só, e isso é de propósito: desfazer não existe nesta rodada, e
-- quando existir será um ESTADO NOVO -- alargar o check numa migração
-- futura -- e nunca um `delete` que finge que a pessoa nunca decidiu.
--
-- `valor_planejado` aqui é o mesmo congelamento da seção 2: o histórico
-- precisa poder dizer "você pulou um mês de 500", e não "de 700", se a
-- regra tiver mudado depois.

create table if not exists public.competencias_de_regra (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  meta_id uuid not null,
  competencia text not null,
  situacao text not null default 'ignorada',
  valor_planejado numeric(14,2) not null,
  decidida_em timestamp with time zone default now() not null
);

alter table public.competencias_de_regra drop constraint if exists competencias_de_regra_pkey cascade;
alter table public.competencias_de_regra add  constraint competencias_de_regra_pkey primary key (id);

-- o par composto, para quem referenciar esta tabela um dia precisar do dono
alter table public.competencias_de_regra drop constraint if exists competencias_de_regra_dono_id_unico;
alter table public.competencias_de_regra add  constraint competencias_de_regra_dono_id_unico unique (user_id, id);

alter table public.competencias_de_regra drop constraint if exists competencia_formato;
alter table public.competencias_de_regra add  constraint competencia_formato
  check (competencia ~ '^\d{4}-(0[1-9]|1[0-2])$');

alter table public.competencias_de_regra drop constraint if exists competencia_situacao_check;
alter table public.competencias_de_regra add  constraint competencia_situacao_check
  check (situacao = 'ignorada');

alter table public.competencias_de_regra drop constraint if exists competencia_planejado_positivo;
alter table public.competencias_de_regra add  constraint competencia_planejado_positivo
  check (valor_planejado > 0);

-- FK COMPOSTA, a regra da 015: a checagem de FK roda POR FORA do RLS, então
-- apontar só por `meta_id` deixaria uma linha minha referenciar meta de
-- outra pessoa. `on delete cascade`: apagada a meta, as decisões dela vão
-- junto -- elas não existem sozinhas.
alter table public.competencias_de_regra drop constraint if exists competencia_da_meta_do_dono;
alter table public.competencias_de_regra add  constraint competencia_da_meta_do_dono
  foreign key (user_id, meta_id) references public.metas(user_id, id) on delete cascade;

alter table public.competencias_de_regra drop constraint if exists competencias_de_regra_user_id_fkey;
alter table public.competencias_de_regra add  constraint competencias_de_regra_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete cascade;

-- UMA decisão por meta por competência, garantida pelo banco e não por
-- `if` de tela -- mesma razão do índice da 016.
drop index if exists public.competencia_uma_por_meta;
create unique index competencia_uma_por_meta
  on public.competencias_de_regra using btree (user_id, meta_id, competencia);

create index if not exists competencias_da_meta
  on public.competencias_de_regra using btree (user_id, meta_id);

comment on table public.competencias_de_regra is
  'Decisões sobre competências da regra mensal. Hoje só "ignorada": aplicada se deriva da alocação, e pendente é a ausência de decisão.';
comment on column public.competencias_de_regra.valor_planejado is
  'Quanto a regra pedia quando a decisão foi tomada. Congela o histórico: mudar a regra depois não reescreve o passado.';

create or replace function public.competencias_set_user_id()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  new.user_id := coalesce(new.user_id, auth.uid());
  return new;
end $$;

drop trigger if exists a_competencias_set_user on public.competencias_de_regra;
create trigger a_competencias_set_user before insert on public.competencias_de_regra
  for each row execute function public.competencias_set_user_id();

alter table public.competencias_de_regra enable row level security;

drop policy if exists competencias_do_dono on public.competencias_de_regra;
create policy competencias_do_dono on public.competencias_de_regra for all to authenticated
  using ((user_id = (select auth.uid() as uid)))
  with check ((user_id = (select auth.uid() as uid)));

-- O DEFEITO DA 012 MORAVA AQUI: no Supabase, objeto novo nasce com
-- permissão para `anon`, e `revoke ... from public` NÃO tira concessão
-- explícita de papel. Por isso o revoke nomeia os papéis, um a um.
revoke all on table public.competencias_de_regra from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.competencias_de_regra to authenticated, service_role;


-- ---------------------------------------------------------------------
-- 4. APLICAR UMA COMPETÊNCIA
-- ---------------------------------------------------------------------
-- Redefine a função da 016. O que muda:
--   - grava `valor_planejado`, congelando a regra daquele instante;
--   - `data` passa a ser o dia 1 da COMPETÊNCIA e `criado_em` continua
--     sendo o instante real. Competência não é data de aplicação;
--   - recusa competência fora da vigência (antes de `regra_desde`);
--   - recusa competência FUTURA -- reservar o mês que vem é adiantar uma
--     decisão que ainda nem chegou;
--   - recusa competência já IGNORADA.
--
-- O que NÃO muda, e é o coração da 016: reserva
-- least(regra, disponível, o que falta para o alvo), e disponível <= 0 não
-- cria linha nenhuma. Alocação de zero não é informação, é ruído.

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

  -- VIGÊNCIA: a regra não alcança mês anterior ao seu começo. Sem isto, uma
  -- regra criada hoje geraria pendência de todo mês desde sempre.
  if m.regra_desde is null or p_competencia < m.regra_desde then
    raise exception 'meta: a regra não valia em %', p_competencia;
  end if;
  if p_competencia > to_char(current_date, 'YYYY-MM') then
    raise exception 'meta: não dá para reservar uma competência futura';
  end if;

  if exists (select 1 from public.competencias_de_regra
              where meta_id = p_meta and competencia = p_competencia) then
    raise exception 'meta: a competência % já foi decidida', p_competencia;
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

  insert into public.alocacoes_de_meta
         (meta_id, valor, data, competencia, origem, obs, valor_planejado)
  values (p_meta, quanto, public.dia_no_mes(p_competencia, 1), p_competencia, 'regra',
          'Regra mensal', m.regra_valor)
  on conflict do nothing;

  alocado := quanto;
end $fn$;


-- ---------------------------------------------------------------------
-- 5. IGNORAR UMA COMPETÊNCIA
-- ---------------------------------------------------------------------
-- Decisão persistente, e por isso uma linha. Recusa ignorar o que já foi
-- aplicado: as duas decisões se contradizem, e deixar as duas coexistirem
-- criaria um histórico que afirma as duas coisas. Postgres não expressa
-- isso em `check` -- a condição atravessa duas tabelas -- então quem cobra
-- é esta função, que é o único caminho até a tabela.

create or replace function public.ignora_competencia_de_regra(
  p_meta uuid, p_competencia text)
returns boolean
language plpgsql
set search_path to 'public'
as $fn$
declare m public.metas%rowtype;
begin
  if auth.uid() is null then
    raise exception 'meta: é preciso estar logado';
  end if;
  if p_competencia !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'meta: a competência precisa estar no formato AAAA-MM';
  end if;

  select * into m from public.metas where id = p_meta;
  if m.id is null then
    raise exception 'meta: não encontrada';
  end if;
  if m.regra_valor is null then
    raise exception 'meta: esta meta não tem regra mensal';
  end if;
  if m.regra_desde is null or p_competencia < m.regra_desde then
    raise exception 'meta: a regra não valia em %', p_competencia;
  end if;

  if exists (select 1 from public.alocacoes_de_meta
              where meta_id = p_meta and competencia = p_competencia and origem = 'regra') then
    raise exception 'meta: a competência % já foi aplicada', p_competencia;
  end if;

  insert into public.competencias_de_regra (meta_id, competencia, situacao, valor_planejado)
  values (p_meta, p_competencia, 'ignorada', m.regra_valor)
  on conflict do nothing;
  return true;
end $fn$;


-- ---------------------------------------------------------------------
-- 6. DESFAZER A REGRA DE UM MÊS
-- ---------------------------------------------------------------------
-- Redefine a da 016 só para apagar a decisão junto, quando houver. Desfazer
-- devolve a competência ao estado de PENDENTE -- que é o que "desfazer"
-- quer dizer -- e deixá-la ignorada seria devolver a um estado que ninguém
-- escolheu.

create or replace function public.desfaz_regra_de_meta(p_meta uuid, p_competencia text)
returns boolean
language plpgsql
set search_path to 'public'
as $fn$
declare
  alocacoes int;
  decisoes int;
begin
  if auth.uid() is null then
    raise exception 'meta: é preciso estar logado';
  end if;

  delete from public.alocacoes_de_meta
   where meta_id = p_meta and competencia = p_competencia and origem = 'regra';
  get diagnostics alocacoes = row_count;

  delete from public.competencias_de_regra
   where meta_id = p_meta and competencia = p_competencia;
  get diagnostics decisoes = row_count;

  -- duas variáveis, e não uma somada: `get diagnostics` atribui a uma
  -- VARIÁVEL, não a uma expressão, e `= apagadas + row_count` nem compila
  return alocacoes + decisoes > 0;
end $fn$;


-- ---------------------------------------------------------------------
-- 7. A AUTOMAÇÃO DA COMPETÊNCIA ATUAL
-- ---------------------------------------------------------------------
-- Uma chamada, uma transação, todas as regras ativas -- e SÓ o mês corrente.
-- Passado nunca entra aqui: é isso que o Modelo C quer dizer.
--
-- ORDEM DETERMINÍSTICA, nunca a que o banco devolver:
--   1. prioridade   (1 alta, 2 média, 3 baixa) -- a escala que já existe
--   2. prazo        mais próximo; sem prazo por último, não tem urgência
--   3. criado_em    e depois id -- desempate estável
-- O disponível é recalculado A CADA META, dentro de `aplica_regra_de_meta`,
-- então com 800 livres duas regras de 500 dão 500 e 300, nunca 500 e 500.
--
-- O LOCK POR USUÁRIO existe porque duas abas abrem juntas. O índice único
-- parcial da 016 já impede a alocação duplicada; o lock impede o caso mais
-- sutil, de duas execuções lendo o mesmo disponível e cada uma alocando para
-- uma meta diferente. `pg_advisory_xact_lock` solta sozinho no fim da
-- transação, inclusive se ela abortar.

create or replace function public.aplica_regras_da_competencia(p_competencia text default null)
returns table (meta_id uuid, alocado numeric, ja_aplicada boolean)
language plpgsql
set search_path to 'public'
as $fn$
declare
  comp text;
  r record;
  res record;
begin
  if auth.uid() is null then
    raise exception 'meta: é preciso estar logado';
  end if;

  comp := coalesce(p_competencia, to_char(current_date, 'YYYY-MM'));
  if comp !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'meta: a competência precisa estar no formato AAAA-MM';
  end if;
  -- A automação é da competência ATUAL. Passar outra é pedir aplicação
  -- retroativa sem consentimento, que é exatamente o que não pode.
  if comp <> to_char(current_date, 'YYYY-MM') then
    raise exception 'meta: a automação só roda na competência atual';
  end if;

  perform pg_advisory_xact_lock(hashtext('regras:' || auth.uid()::text));

  for r in
    select m.id, m.prazo, m.prioridade, m.criado_em
      from public.metas m
     where m.regra_ativa
       and m.status = 'ativa'
       and m.regra_desde is not null
       and m.regra_desde <= comp
       and not exists (select 1 from public.alocacoes_de_meta a
                        where a.meta_id = m.id and a.competencia = comp and a.origem = 'regra')
       and not exists (select 1 from public.competencias_de_regra c
                        where c.meta_id = m.id and c.competencia = comp)
     order by m.prioridade asc,
              m.prazo asc nulls last,
              m.criado_em asc,
              m.id asc
  loop
    select * into res from public.aplica_regra_de_meta(r.id, comp);
    meta_id := r.id;
    alocado := res.alocado;
    ja_aplicada := res.ja_aplicada;
    return next;
  end loop;
end $fn$;


-- ---------------------------------------------------------------------
-- 8. REGULARIZAR PENDÊNCIAS ESCOLHIDAS
-- ---------------------------------------------------------------------
-- A pessoa marcou N competências passadas e confirmou. Uma chamada só, para
-- o disponível ser recalculado em sequência e a soma nunca passar dele.
--
-- A ORDEM É EXPLÍCITA e igual à da automação, mais a competência: prioridade,
-- prazo, competência MAIS ANTIGA, criado_em, id. Sem isto, a mesma seleção
-- daria resultados diferentes conforme a ordem em que a tela mandou.
--
-- Cada competência é uma operação completa. Uma que não couber não desfaz as
-- que couberam: são reservas independentes, e desfazer três boas por causa da
-- quarta seria pior do que dizer que a quarta não coube.

create or replace function public.regulariza_competencias(p_itens jsonb)
returns table (meta_id uuid, competencia text, alocado numeric, erro text)
language plpgsql
set search_path to 'public'
as $fn$
declare
  r record;
  res record;
begin
  if auth.uid() is null then
    raise exception 'meta: é preciso estar logado';
  end if;
  if p_itens is null or jsonb_typeof(p_itens) <> 'array' then
    raise exception 'meta: a lista de competências precisa ser um array';
  end if;

  perform pg_advisory_xact_lock(hashtext('regras:' || auth.uid()::text));

  for r in
    select (i->>'meta_id')::uuid as mid, i->>'competencia' as comp,
           m.prioridade, m.prazo, m.criado_em
      from jsonb_array_elements(p_itens) i
      join public.metas m on m.id = (i->>'meta_id')::uuid
     order by m.prioridade asc,
              m.prazo asc nulls last,
              (i->>'competencia') asc,
              m.criado_em asc,
              m.id asc
  loop
    meta_id := r.mid;
    competencia := r.comp;
    alocado := 0;
    erro := null;
    begin
      select * into res from public.aplica_regra_de_meta(r.mid, r.comp);
      alocado := res.alocado;
    exception when others then
      -- o erro de UMA competência não derruba as outras; ele volta na linha
      -- dela, para a tela poder dizer qual não deu e por quê
      erro := sqlerrm;
    end;
    return next;
  end loop;
end $fn$;


-- ---------------------------------------------------------------------
-- 9. PERMISSÕES
-- ---------------------------------------------------------------------
-- O revoke nomeia os papéis um a um, pela mesma razão da 013: função nova no
-- Supabase nasce com `execute` para `anon`, e `revoke ... from public` não
-- tira concessão explícita de papel.

revoke all on function public.aplica_regra_de_meta(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.aplica_regra_de_meta(uuid, text) to authenticated, service_role;

revoke all on function public.desfaz_regra_de_meta(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.desfaz_regra_de_meta(uuid, text) to authenticated, service_role;

revoke all on function public.ignora_competencia_de_regra(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.ignora_competencia_de_regra(uuid, text) to authenticated, service_role;

revoke all on function public.aplica_regras_da_competencia(text) from public, anon, authenticated, service_role;
grant execute on function public.aplica_regras_da_competencia(text) to authenticated, service_role;

revoke all on function public.regulariza_competencias(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.regulariza_competencias(jsonb) to authenticated, service_role;

revoke all on function public.competencias_set_user_id() from public, anon;


-- ---------------------------------------------------------------------
-- 10. A VIGÊNCIA DAS REGRAS QUE JÁ EXISTEM
-- ---------------------------------------------------------------------
-- Zero linhas hoje, conferido no pré-flight. O update fica aqui assim mesmo,
-- porque o arquivo precisa continuar correto numa base que já tenha regra
-- ligada: sem `regra_desde`, o check da seção 1 recusaria a linha.
-- `to_char(current_date)` é a leitura honesta -- uma regra que já existia não
-- tem começo registrado, e inventar um no passado criaria pendência de meses
-- que ninguém decidiu não aplicar.

update public.metas
   set regra_desde = to_char(current_date, 'YYYY-MM')
 where regra_ativa and regra_desde is null;


-- ---------------------------------------------------------------------
-- 11. CONFERÊNCIA
-- ---------------------------------------------------------------------
do $$
declare
  n_tab int; n_pol int; n_fn int; n_idx int; n_rls int;
begin
  select count(*) into n_tab from pg_tables
   where schemaname = 'public' and tablename = 'competencias_de_regra';
  select count(*) into n_pol from pg_policies
   where schemaname = 'public' and tablename = 'competencias_de_regra';
  select count(*) into n_fn from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in
     ('aplica_regra_de_meta','desfaz_regra_de_meta','ignora_competencia_de_regra',
      'aplica_regras_da_competencia','regulariza_competencias');
  select count(*) into n_idx from pg_indexes
   where schemaname = 'public' and indexname = 'competencia_uma_por_meta';
  select count(*) into n_rls from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'competencias_de_regra' and c.relrowsecurity;

  raise notice '017 pronta: % tabela, % policy, % funções, % índice único, RLS=%',
    n_tab, n_pol, n_fn, n_idx, n_rls;
end $$;


-- ---------------------------------------------------------------------
-- ROLLBACK, se precisar
-- ---------------------------------------------------------------------
-- Ela é reversível: não apaga coluna de ninguém, não estreita check
-- existente e não toca em dado. Desfazer é isto, de baixo para cima --
-- lembrando que as duas funções da 016 voltariam ao corpo DELA, não sumiriam:
--
--   drop function if exists public.regulariza_competencias(jsonb);
--   drop function if exists public.aplica_regras_da_competencia(text);
--   drop function if exists public.ignora_competencia_de_regra(uuid, text);
--   drop table if exists public.competencias_de_regra;
--   drop function if exists public.competencias_set_user_id();
--   alter table public.alocacoes_de_meta drop constraint if exists manual_nao_tem_planejado;
--   alter table public.alocacoes_de_meta drop constraint if exists valor_planejado_positivo;
--   alter table public.alocacoes_de_meta drop column if exists valor_planejado;
--   alter table public.metas drop constraint if exists regra_ativa_tem_desde;
--   alter table public.metas drop constraint if exists regra_desde_formato;
--   alter table public.metas drop column if exists regra_desde;
--   -- e reaplicar as duas funções como estão em 016_v2_regra_de_alocacao.sql
