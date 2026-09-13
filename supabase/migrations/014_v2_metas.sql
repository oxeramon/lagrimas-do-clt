-- 014 · METAS: envelope, não dinheiro
--
-- O CONTRATO INTEIRO ESTÁ EM docs/CONTRATO_METAS.md, e a frase que governa tudo
-- é esta: meta é ENVELOPE, conta é onde o dinheiro ESTÁ.
--
-- Uma meta não cria dinheiro, não move dinheiro e não altera saldo bancário.
-- Ela declara um destino para dinheiro que já existe. O erro que este modelo
-- existe para impedir:
--
--   saldo da conta   10.000
--   meta "Viagem"     5.000
--   "patrimônio"     15.000   <- ERRADO. São os mesmos 10.000.
--
-- Por isso: NENHUMA transação é criada ao alocar, e NENHUMA coluna de conta
-- aparece aqui. Alocar não é movimento; é intenção.
--
-- `reservado` NÃO é coluna de metas. Ele é a soma das alocações, e guardar uma
-- soma que se deriva é combinar de tê-la errada um dia.
--
-- A ALOCAÇÃO TEM SINAL. Positivo reserva, negativo libera. Liberar 200 é uma
-- linha de -200, não a exclusão de uma linha de +200 -- assim a pessoa lê o que
-- aconteceu, em vez de ver o histórico encolher.

create table if not exists public.metas (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null,
  nome         text not null,
  valor_alvo   numeric(14,2) not null,
  prazo        date,
  prioridade   smallint not null default 2,
  cor          text not null default '',
  icone        text not null default '',
  status       text not null default 'ativa',
  obs          text not null default '',
  ordem        integer not null default 0,
  criado_em    timestamptz not null default now(),
  constraint metas_valor_alvo_check check (valor_alvo > 0),
  constraint metas_prioridade_check check (prioridade between 1 and 3),
  constraint metas_status_check     check (status in ('ativa','concluida','arquivada')),
  constraint metas_nome_check       check (length(nome) between 1 and 80),
  -- FK composta com o dono, como todas desde a 002: a checagem de FK roda por
  -- fora do RLS, então (user_id, id) é o que impede referência cruzada.
  constraint metas_dono_id_unico    unique (user_id, id)
);

comment on table public.metas is
  'Objetivo de destinação. NÃO guarda dinheiro e NÃO altera saldo: ver docs/CONTRATO_METAS.md.';

alter table public.metas enable row level security;

drop policy if exists metas_do_dono on public.metas;
create policy metas_do_dono on public.metas
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create or replace function public.metas_set_user_id()
returns trigger language plpgsql set search_path to 'public' as $fn$
begin
  new.user_id := coalesce(new.user_id, auth.uid());
  return new;
end $fn$;

drop trigger if exists metas_set_user on public.metas;
create trigger metas_set_user before insert on public.metas
  for each row execute function public.metas_set_user_id();

create index if not exists metas_do_usuario on public.metas (user_id, status, ordem);

create table if not exists public.alocacoes_de_meta (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null,
  meta_id    uuid not null,
  valor      numeric(14,2) not null,
  data       date not null default current_date,
  obs        text not null default '',
  criado_em  timestamptz not null default now(),
  -- zero não é reserva nem liberação: é linha sem significado
  constraint alocacao_valor_check check (valor <> 0),
  constraint alocacao_da_meta_do_dono
    foreign key (user_id, meta_id) references public.metas (user_id, id) on delete cascade
);

comment on table public.alocacoes_de_meta is
  'Uma linha por reserva ou liberação. Valor com SINAL: positivo reserva, negativo libera. NÃO gera transação.';

alter table public.alocacoes_de_meta enable row level security;

drop policy if exists alocacoes_do_dono on public.alocacoes_de_meta;
create policy alocacoes_do_dono on public.alocacoes_de_meta
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create or replace function public.alocacoes_set_user_id()
returns trigger language plpgsql set search_path to 'public' as $fn$
begin
  new.user_id := coalesce(new.user_id, auth.uid());
  return new;
end $fn$;

drop trigger if exists alocacoes_set_user on public.alocacoes_de_meta;
-- O nome leva a ORDEM: gatilhos do mesmo evento disparam em ordem alfabética, e
-- o de user_id precisa rodar ANTES do que confere o saldo. Foi esse exato
-- defeito que a 002 consertou em categorias.
create trigger a_alocacoes_set_user before insert on public.alocacoes_de_meta
  for each row execute function public.alocacoes_set_user_id();

create index if not exists alocacoes_da_meta on public.alocacoes_de_meta (user_id, meta_id, data);

-- Só conta LIVRE entra. Dinheiro restrito ou bloqueado não pode ser prometido a
-- uma viagem, e js/domain/accounts.js já faz essa separação na tela -- aqui ela
-- é a mesma, para os dois lados não discordarem.
create or replace function public.saldo_livre_do_usuario()
returns numeric language sql stable set search_path to 'public'
as $fn$
  select coalesce(sum(s.saldo), 0)::numeric(14,2)
    from public.saldos_de_conta s
   where s.liquidez = 'livre';
$fn$;

create or replace function public.total_reservado_em_metas()
returns numeric language sql stable set search_path to 'public'
as $fn$
  select coalesce(sum(a.valor), 0)::numeric(14,2)
    from public.alocacoes_de_meta a
    join public.metas m on m.id = a.meta_id
   where m.status <> 'arquivada';
$fn$;

-- Gatilho, e não um if na tela: a tela protege só quem passa por ela, e o
-- PostgREST aceita insert direto.
--
-- O QUE ELE NÃO GARANTE, e está no contrato: que o saldo livre não caia DEPOIS.
-- Reservou 5.000 e depois gastou? O reservado passa o saldo, e isso não é erro
-- do modelo -- é a realidade. A tela mostra como "meta em risco" em vez de
-- impedir um gasto que já aconteceu.
create or replace function public.confere_alocacao_de_meta()
returns trigger language plpgsql set search_path to 'public'
as $fn$
declare
  livre numeric;
  reservado numeric;
begin
  reservado := public.total_reservado_em_metas();
  -- liberar (valor negativo) nunca precisa de saldo: ela só devolve
  if reservado <= 0 then return new; end if;
  livre := public.saldo_livre_do_usuario();
  if reservado > livre then
    raise exception 'meta: não dá para reservar % com % livre em conta. Meta é envelope, não dinheiro novo.',
      reservado, livre using errcode = 'check_violation';
  end if;
  return new;
end $fn$;

drop trigger if exists confere_alocacao_de_meta on public.alocacoes_de_meta;
-- DIFERIDO: as alocações entram uma a uma, e um gatilho imediato leria o estado
-- do meio. Mesma razão do rateio da 009 e do pagamento de fatura da 012.
create constraint trigger confere_alocacao_de_meta
  after insert or update on public.alocacoes_de_meta
  deferrable initially deferred
  for each row execute function public.confere_alocacao_de_meta();

-- reservado, falta e percentual DERIVADOS. Guardar qualquer um deles é combinar
-- de tê-lo errado assim que uma alocação entrar por outro caminho.
create or replace view public.metas_resolvidas
with (security_invoker = true)
as
select
  m.id as meta_id, m.user_id, m.nome, m.valor_alvo, m.prazo, m.prioridade,
  m.cor, m.icone, m.status, m.obs, m.ordem, m.criado_em,
  coalesce(a.reservado, 0)::numeric(14,2) as reservado,
  greatest(m.valor_alvo - coalesce(a.reservado, 0), 0)::numeric(14,2) as falta,
  coalesce(a.quantas, 0) as alocacoes,
  -- percentual limitado a 100: barra passando de 100% não informa nada
  least(round(coalesce(a.reservado, 0) * 100 / m.valor_alvo), 100)::int as percentual,
  -- meses até o prazo, PELO MENOS 1: meta que vence este mês precisa do valor
  -- inteiro agora, não de uma divisão por zero
  case when m.prazo is null then null
       else greatest(1, (date_part('year',  age(m.prazo, current_date)) * 12
                       + date_part('month', age(m.prazo, current_date)))::int + 1)
  end as meses_ate_prazo
from public.metas m
left join lateral (
  select sum(x.valor) as reservado, count(*) as quantas
    from public.alocacoes_de_meta x
   where x.meta_id = m.id and x.user_id = m.user_id
) a on true;

grant select on public.metas_resolvidas to authenticated;

comment on view public.metas_resolvidas is
  'Meta com reservado, falta e percentual derivados. NÃO some reservado com saldo de conta: é o mesmo dinheiro visto de outro ângulo.';

revoke all on function public.saldo_livre_do_usuario() from public, anon;
revoke all on function public.total_reservado_em_metas() from public, anon;
revoke all on function public.confere_alocacao_de_meta() from public, anon, authenticated;
revoke all on function public.metas_set_user_id() from public, anon, authenticated;
revoke all on function public.alocacoes_set_user_id() from public, anon, authenticated;
grant execute on function public.saldo_livre_do_usuario() to authenticated;
grant execute on function public.total_reservado_em_metas() to authenticated;
grant select, insert, update, delete on public.metas to authenticated;
grant select, insert, update, delete on public.alocacoes_de_meta to authenticated;
