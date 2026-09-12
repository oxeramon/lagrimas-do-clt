-- =====================================================================
-- 009 · GRUPOS, RATEIOS E ACERTOS
-- =====================================================================
-- A separação que organiza esta migração, e que é a mesma ideia das
-- anteriores vista de mais um ângulo:
--
--     GRUPO calcula OBRIGAÇÃO.     "Carlos te deve R$ 100"
--     TRANSAÇÃO calcula DINHEIRO.  "Carlos pagou R$ 100 na sua conta"
--
-- As duas se relacionam e NÃO são a mesma coisa. Registrar um acerto no grupo
-- não move dinheiro nenhum; mover dinheiro não quita dívida de grupo sozinho.
-- Quem liga as duas é a pessoa, escolhendo a conta -- nunca o app por conta
-- própria. Adivinhar aqui é a maneira mais rápida de inventar uma entrada que
-- não existiu.
--
-- MINIMIZAÇÃO DE DADOS: membro de grupo NÃO é usuário do app e não precisa
-- ser. Guarda-se nome, apelido e nada mais. Sem e-mail, sem telefone, sem
-- documento -- não porque seja difícil, mas porque não é necessário, e dado
-- pessoal que não existe não vaza.
--
-- O CONTRATO DOS CENTAVOS: a soma dos rateios é EXATAMENTE o valor da despesa.
-- Não "aproximadamente". Um gatilho postergado cobra isso, e ele existe porque
-- diferença de centavo em rateio vira discussão entre amigos.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. GRUPO
-- ---------------------------------------------------------------------
create table if not exists public.grupos (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  nome       text not null check (length(nome) between 1 and 60),
  obs        text not null default '',
  ativo      boolean not null default true,
  ordem      integer not null default 0,
  criado_em  timestamptz not null default now(),
  constraint grupo_nome_unico unique (user_id, nome),
  constraint grupos_dono_id_unico unique (user_id, id)
);

create index if not exists grupos_user_idx on public.grupos (user_id, ordem, nome);

alter table public.grupos enable row level security;
drop policy if exists grupos_own on public.grupos;
create policy grupos_own on public.grupos
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop trigger if exists grupos_set_user on public.grupos;
create trigger grupos_set_user before insert on public.grupos
  for each row execute function public.set_user_id();

-- ---------------------------------------------------------------------
-- 2. MEMBRO
-- ---------------------------------------------------------------------
-- `sou_eu` marca quem é a pessoa dona do app dentro do grupo. Sem isso não dá
-- para dizer "você recebe" ou "você deve" -- só "A deve a B", que não ajuda
-- ninguém a decidir nada.
--
-- Exatamente um membro por grupo pode ser `sou_eu`, e o índice parcial único
-- abaixo garante isso. Zero também é válido: um grupo pode existir só para
-- acompanhar o rateio de outras pessoas.
create table if not exists public.membros (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  grupo_id   uuid not null,
  nome       text not null check (length(nome) between 1 and 60),
  apelido    text not null default '' check (length(apelido) <= 30),
  sou_eu     boolean not null default false,
  ativo      boolean not null default true,
  ordem      integer not null default 0,
  criado_em  timestamptz not null default now(),
  constraint membro_nome_unico_no_grupo unique (user_id, grupo_id, nome),
  constraint membros_dono_id_unico unique (user_id, id)
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'membros_grupo_dono_fk') then
    alter table public.membros
      add constraint membros_grupo_dono_fk
      foreign key (user_id, grupo_id) references public.grupos (user_id, id)
      on update cascade on delete cascade;
  end if;
end $$;

create index if not exists membros_grupo_idx on public.membros (user_id, grupo_id, ordem, nome);
create unique index if not exists membro_um_sou_eu_por_grupo
  on public.membros (user_id, grupo_id) where sou_eu;

alter table public.membros enable row level security;
drop policy if exists membros_own on public.membros;
create policy membros_own on public.membros
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop trigger if exists membros_set_user on public.membros;
create trigger membros_set_user before insert on public.membros
  for each row execute function public.set_user_id();

-- ---------------------------------------------------------------------
-- 3. DESPESA COMPARTILHADA
-- ---------------------------------------------------------------------
-- Uma despesa do grupo NÃO é uma transação. Ela pode ter sido paga por outra
-- pessoa, com o dinheiro dela, e nesse caso nada saiu de conta alguma sua.
-- Somar as duas listas contaria gasto alheio como seu.
create table if not exists public.despesas_do_grupo (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  grupo_id       uuid not null,
  pago_por_id    uuid not null,
  categoria_id   uuid,
  descricao      text not null check (length(descricao) between 1 and 120),
  valor          numeric(14,2) not null check (valor > 0),
  data           date not null,
  obs            text not null default '',
  criado_em      timestamptz not null default now(),
  constraint despesas_do_grupo_dono_id_unico unique (user_id, id)
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'despesas_grupo_dono_fk') then
    alter table public.despesas_do_grupo
      add constraint despesas_grupo_dono_fk
      foreign key (user_id, grupo_id) references public.grupos (user_id, id)
      on update cascade on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'despesas_pagador_dono_fk') then
    alter table public.despesas_do_grupo
      add constraint despesas_pagador_dono_fk
      foreign key (user_id, pago_por_id) references public.membros (user_id, id)
      on update cascade on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'despesas_categoria_dono_fk') then
    alter table public.despesas_do_grupo
      add constraint despesas_categoria_dono_fk
      foreign key (user_id, categoria_id) references public.categorias (user_id, id)
      on update cascade on delete set null (categoria_id);
  end if;
end $$;

create index if not exists despesas_grupo_idx on public.despesas_do_grupo (user_id, grupo_id, data);

alter table public.despesas_do_grupo enable row level security;
drop policy if exists despesas_do_grupo_own on public.despesas_do_grupo;
create policy despesas_do_grupo_own on public.despesas_do_grupo
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop trigger if exists despesas_do_grupo_set_user on public.despesas_do_grupo;
create trigger despesas_do_grupo_set_user before insert on public.despesas_do_grupo
  for each row execute function public.set_user_id();

-- ---------------------------------------------------------------------
-- 4. RATEIO
-- ---------------------------------------------------------------------
-- Quanto cabe a cada um. Uma linha por membro por despesa.
create table if not exists public.rateios (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  despesa_id  uuid not null,
  membro_id   uuid not null,
  valor       numeric(14,2) not null check (valor >= 0),
  criado_em   timestamptz not null default now(),
  constraint rateio_um_por_membro unique (user_id, despesa_id, membro_id),
  constraint rateios_dono_id_unico unique (user_id, id)
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'rateios_despesa_dono_fk') then
    alter table public.rateios
      add constraint rateios_despesa_dono_fk
      foreign key (user_id, despesa_id) references public.despesas_do_grupo (user_id, id)
      on update cascade on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'rateios_membro_dono_fk') then
    alter table public.rateios
      add constraint rateios_membro_dono_fk
      foreign key (user_id, membro_id) references public.membros (user_id, id)
      on update cascade on delete restrict;
  end if;
end $$;

create index if not exists rateios_despesa_idx on public.rateios (user_id, despesa_id);
create index if not exists rateios_membro_idx on public.rateios (user_id, membro_id);

alter table public.rateios enable row level security;
drop policy if exists rateios_own on public.rateios;
create policy rateios_own on public.rateios
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop trigger if exists rateios_set_user on public.rateios;
create trigger rateios_set_user before insert on public.rateios
  for each row execute function public.set_user_id();

-- ---------------------------------------------------------------------
-- 5. O CONTRATO DOS CENTAVOS, COBRADO PELO BANCO
-- ---------------------------------------------------------------------
-- A soma dos rateios é EXATAMENTE o valor da despesa. Não aproximadamente.
--
-- O gatilho é POSTERGADO -- `deferrable initially deferred` -- porque durante a
-- inserção de uma despesa os rateios entram um a um, e conferir a cada linha
-- recusaria a primeira. A conferência acontece no fim da transação, quando
-- todas já estão lá. É a mesma técnica que a 002 usa para as duas pernas de
-- uma transferência.
--
-- Despesa sem rateio nenhum é estado inválido, e o gatilho pega isso também:
-- a soma de zero linhas é zero, e zero é diferente do valor da despesa.
create or replace function public.confere_soma_do_rateio()
returns trigger language plpgsql security invoker set search_path = public as $$
declare
  alvo uuid;
  d record;
  somado numeric(14,2);
begin
  alvo := coalesce(new.despesa_id, old.despesa_id);

  select * into d from public.despesas_do_grupo where id = alvo;
  -- a despesa pode ter sido apagada na mesma transação; aí não há o que conferir
  if d.id is null then return null; end if;

  select coalesce(sum(valor), 0) into somado from public.rateios where despesa_id = alvo;
  if somado <> d.valor then
    raise exception 'rateio: as partes somam % e a despesa é de % -- a diferença precisa ser zero',
      somado, d.valor;
  end if;
  return null;
end $$;

drop trigger if exists rateios_somam_a_despesa on public.rateios;
create constraint trigger rateios_somam_a_despesa
  after insert or update or delete on public.rateios
  deferrable initially deferred
  for each row execute function public.confere_soma_do_rateio();

-- Mexer no valor da despesa depois dos rateios também quebraria a soma. Este é
-- o mesmo contrato visto do outro lado, e por isso é uma função separada: ela
-- olha `new.id` em vez de `new.despesa_id`.
--
-- Ela NÃO vale para o insert: a despesa nasce antes dos rateios, sempre, e
-- cobrar na inserção recusaria toda despesa.
create or replace function public.confere_soma_da_despesa()
returns trigger language plpgsql security invoker set search_path = public as $$
declare
  somado numeric(14,2);
begin
  select coalesce(sum(valor), 0) into somado from public.rateios where despesa_id = new.id;
  if somado <> new.valor then
    raise exception 'rateio: as partes somam % e a despesa passou a ser de % -- reveja a divisão',
      somado, new.valor;
  end if;
  return null;
end $$;

drop trigger if exists despesa_confere_rateio on public.despesas_do_grupo;
create constraint trigger despesa_confere_rateio
  after update on public.despesas_do_grupo
  deferrable initially deferred
  for each row execute function public.confere_soma_da_despesa();

-- ---------------------------------------------------------------------
-- 6. ACERTO
-- ---------------------------------------------------------------------
-- "Carlos pagou R$ 100" -- a obrigação sendo quitada. `transacao_id` é
-- OPCIONAL de propósito: o dinheiro pode ter entrado em espécie, e registrar
-- uma entrada em conta que não aconteceu seria pior do que não registrar nada.
--
-- Quando a pessoa ESCOLHE uma conta, a RPC cria a transação e liga as duas.
-- Nunca automaticamente.
create table if not exists public.acertos (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  grupo_id      uuid not null,
  de_id         uuid not null,
  para_id       uuid not null,
  valor         numeric(14,2) not null check (valor > 0),
  data          date not null,
  transacao_id  uuid,
  obs           text not null default '',
  criado_em     timestamptz not null default now(),
  constraint acerto_entre_dois check (de_id <> para_id),
  constraint acertos_dono_id_unico unique (user_id, id)
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'acertos_grupo_dono_fk') then
    alter table public.acertos
      add constraint acertos_grupo_dono_fk
      foreign key (user_id, grupo_id) references public.grupos (user_id, id)
      on update cascade on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'acertos_de_dono_fk') then
    alter table public.acertos
      add constraint acertos_de_dono_fk
      foreign key (user_id, de_id) references public.membros (user_id, id)
      on update cascade on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'acertos_para_dono_fk') then
    alter table public.acertos
      add constraint acertos_para_dono_fk
      foreign key (user_id, para_id) references public.membros (user_id, id)
      on update cascade on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'acertos_transacao_dono_fk') then
    alter table public.acertos
      add constraint acertos_transacao_dono_fk
      foreign key (user_id, transacao_id) references public.transacoes (user_id, id)
      on update cascade on delete set null (transacao_id);
  end if;
end $$;

create index if not exists acertos_grupo_idx on public.acertos (user_id, grupo_id, data);

alter table public.acertos enable row level security;
drop policy if exists acertos_own on public.acertos;
create policy acertos_own on public.acertos
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop trigger if exists acertos_set_user on public.acertos;
create trigger acertos_set_user before insert on public.acertos
  for each row execute function public.set_user_id();

-- ---------------------------------------------------------------------
-- 7. O SALDO DE CADA MEMBRO
-- ---------------------------------------------------------------------
-- saldo = o que ele pagou − o que lhe cabia + o que já recebeu de acerto
--         − o que já pagou de acerto
--
-- Positivo: tem a receber. Negativo: deve. E a soma de todos os saldos de um
-- grupo é sempre zero -- é assim que se sabe que a conta fecha.
create or replace view public.saldos_do_grupo
with (security_invoker = on) as
select
  m.id        as membro_id,
  m.user_id,
  m.grupo_id,
  m.nome,
  m.apelido,
  m.sou_eu,
  m.ativo,
  coalesce((select sum(d.valor) from public.despesas_do_grupo d
             where d.pago_por_id = m.id and d.user_id = m.user_id), 0)::numeric(14,2) as pagou,
  coalesce((select sum(r.valor) from public.rateios r
             where r.membro_id = m.id and r.user_id = m.user_id), 0)::numeric(14,2) as coube,
  coalesce((select sum(a.valor) from public.acertos a
             where a.para_id = m.id and a.user_id = m.user_id), 0)::numeric(14,2) as recebeu,
  coalesce((select sum(a.valor) from public.acertos a
             where a.de_id = m.id and a.user_id = m.user_id), 0)::numeric(14,2) as quitou,
  (coalesce((select sum(d.valor) from public.despesas_do_grupo d
              where d.pago_por_id = m.id and d.user_id = m.user_id), 0)
   - coalesce((select sum(r.valor) from public.rateios r
                where r.membro_id = m.id and r.user_id = m.user_id), 0)
   - coalesce((select sum(a.valor) from public.acertos a
                where a.para_id = m.id and a.user_id = m.user_id), 0)
   + coalesce((select sum(a.valor) from public.acertos a
                where a.de_id = m.id and a.user_id = m.user_id), 0))::numeric(14,2) as saldo
from public.membros m;

-- ---------------------------------------------------------------------
-- 8. REGISTRAR UMA DESPESA COM SEU RATEIO
-- ---------------------------------------------------------------------
-- Uma chamada, uma transação. A despesa e as partes nascem juntas ou não
-- nascem -- despesa sem rateio no banco é um número sem dono.
--
-- `p_rateios` vem como jsonb: [{"membro":"<uuid>","valor":10.00}, ...]. O
-- gatilho postergado confere a soma no fim, então a função não precisa
-- reimplementar essa checagem -- e, mais importante, não PODE ser contornada
-- por quem escrever direto na tabela.
create or replace function public.registra_despesa_do_grupo(
  p_grupo      uuid,
  p_descricao  text,
  p_valor      numeric,
  p_data       date,
  p_pago_por   uuid,
  p_rateios    jsonb,
  p_categoria  uuid default null,
  p_obs        text default '')
returns uuid language plpgsql security invoker set search_path = public as $$
declare
  nova uuid;
  item jsonb;
  quantos int;
begin
  if auth.uid() is null then
    raise exception 'grupo: é preciso estar logado';
  end if;
  if p_valor is null or p_valor <= 0 then
    raise exception 'grupo: o valor precisa ser maior que zero';
  end if;

  select count(*) into quantos from public.grupos where id = p_grupo;
  if quantos <> 1 then
    raise exception 'grupo: não encontrado';
  end if;
  select count(*) into quantos from public.membros
   where id = p_pago_por and grupo_id = p_grupo;
  if quantos <> 1 then
    raise exception 'grupo: quem pagou precisa ser membro deste grupo';
  end if;

  if p_rateios is null or jsonb_array_length(p_rateios) = 0 then
    raise exception 'rateio: uma despesa sem partes é um número sem dono';
  end if;

  insert into public.despesas_do_grupo
    (grupo_id, pago_por_id, categoria_id, descricao, valor, data, obs)
  values (p_grupo, p_pago_por, p_categoria, p_descricao, p_valor, p_data, coalesce(p_obs,''))
  returning id into nova;

  for item in select * from jsonb_array_elements(p_rateios) loop
    select count(*) into quantos from public.membros
     where id = (item->>'membro')::uuid and grupo_id = p_grupo;
    if quantos <> 1 then
      raise exception 'rateio: só membro do grupo entra na divisão';
    end if;
    insert into public.rateios (despesa_id, membro_id, valor)
    values (nova, (item->>'membro')::uuid, (item->>'valor')::numeric);
  end loop;

  -- a conferência da soma acontece no COMMIT, pelo gatilho postergado
  return nova;
end $$;

-- ---------------------------------------------------------------------
-- 9. REGISTRAR UM ACERTO
-- ---------------------------------------------------------------------
-- Com `p_conta` preenchida, cria também a movimentação -- entrada quando o
-- dinheiro vem para você, saída quando sai de você -- e liga as duas.
--
-- Sem `p_conta`, registra só a quitação da obrigação. O dinheiro pode ter
-- passado em espécie, e inventar uma entrada em conta seria pior do que não
-- registrar nada.
create or replace function public.registra_acerto(
  p_grupo  uuid,
  p_de     uuid,
  p_para   uuid,
  p_valor  numeric,
  p_data   date,
  p_conta  uuid default null,
  p_obs    text default '')
returns uuid language plpgsql security invoker set search_path = public as $$
declare
  novo uuid;
  tx uuid := null;
  quantos int;
  eu_recebo boolean;
  eu_pago boolean;
  outro text;
begin
  if auth.uid() is null then
    raise exception 'grupo: é preciso estar logado';
  end if;
  if p_valor is null or p_valor <= 0 then
    raise exception 'acerto: o valor precisa ser maior que zero';
  end if;
  if p_de = p_para then
    raise exception 'acerto: quem paga e quem recebe precisam ser pessoas diferentes';
  end if;

  select count(*) into quantos from public.membros
   where id in (p_de, p_para) and grupo_id = p_grupo;
  if quantos <> 2 then
    raise exception 'acerto: as duas pessoas precisam ser membros deste grupo';
  end if;

  if p_conta is not null then
    select count(*) into quantos from public.contas where id = p_conta;
    if quantos <> 1 then
      raise exception 'acerto: conta não encontrada';
    end if;

    select sou_eu into eu_recebo from public.membros where id = p_para;
    select sou_eu into eu_pago   from public.membros where id = p_de;
    if not coalesce(eu_recebo, false) and not coalesce(eu_pago, false) then
      raise exception 'acerto: só entra em conta o acerto de que você participa';
    end if;

    select nome into outro from public.membros
     where id = case when coalesce(eu_recebo, false) then p_de else p_para end;

    insert into public.transacoes
      (conta_id, tipo, natureza, descricao, valor, data, status, origem, origem_id, obs)
    values
      (p_conta,
       case when coalesce(eu_recebo, false) then 'entrada' else 'saida' end,
       'normal',
       'Acerto com ' || coalesce(outro, 'o grupo'),
       p_valor, p_data, 'realizada', 'manual', '', coalesce(p_obs,''))
    returning id into tx;
  end if;

  insert into public.acertos (grupo_id, de_id, para_id, valor, data, transacao_id, obs)
  values (p_grupo, p_de, p_para, p_valor, p_data, tx, coalesce(p_obs,''))
  returning id into novo;

  return novo;
end $$;

-- ---------------------------------------------------------------------
-- 10. QUEM PODE CHAMAR
-- ---------------------------------------------------------------------
-- `confere_soma_do_rateio` e `confere_soma_da_despesa` são funções de GATILHO.
-- Elas não são API, e a 006 já ensinou essa lição: função de gatilho não fica
-- chamável por ninguém.
revoke execute on function public.confere_soma_do_rateio() from public, anon, authenticated;
revoke execute on function public.confere_soma_da_despesa() from public, anon, authenticated;

revoke execute on function public.registra_despesa_do_grupo(uuid, text, numeric, date, uuid, jsonb, uuid, text) from public, anon;
revoke execute on function public.registra_acerto(uuid, uuid, uuid, numeric, date, uuid, text) from public, anon;

grant execute on function public.registra_despesa_do_grupo(uuid, text, numeric, date, uuid, jsonb, uuid, text) to authenticated;
grant execute on function public.registra_acerto(uuid, uuid, uuid, numeric, date, uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- 11. CONFERÊNCIA
-- ---------------------------------------------------------------------
select 'grupos' as objeto, count(*) as linhas from public.grupos
union all select 'membros', count(*) from public.membros
union all select 'despesas_do_grupo', count(*) from public.despesas_do_grupo
union all select 'rateios', count(*) from public.rateios
union all select 'acertos', count(*) from public.acertos;
