-- =====================================================================
-- 007 · CARTÕES E FATURAS
-- =====================================================================
-- O contrato está em docs/CONTRATO_CARTAO.md e foi escrito antes deste
-- arquivo. Ele cabe em duas frases:
--
--     Compra no cartão é despesa.
--     Pagamento da fatura não é despesa nova.
--
-- O que torna a dupla contagem IMPOSSÍVEL de escrever, e não apenas
-- improvável, é uma assimetria em `transacoes`:
--
--     compra no cartão      fatura_id preenchido, conta_id VAZIO
--     pagamento da fatura   conta_id preenchido,  fatura_id VAZIO
--
-- Assim "quanto eu gastei" (tipo='saida' e natureza='normal') e "quanto saiu
-- da conta" (conta_id not null) são dois filtros que nunca se cruzam, e
-- nenhum dos dois precisa conhecer o outro.
--
-- PRÉ-CONDIÇÃO: `transacoes` está vazia. É por isso que dá para apertar os
-- `check` dela aqui sem migração de dados.
--
-- NADA nesta migração toca a V1. `credores` continua onde está.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. CARTÕES
-- ---------------------------------------------------------------------
-- O que NUNCA entra aqui: número completo, CVV, validade, senha, token,
-- nome impresso. Quatro dígitos bastam para a pessoa saber de qual cartão
-- se trata, e é o máximo que este produto tem motivo para saber. O `check`
-- de exatamente quatro dígitos não é conforto: é o que impede um número
-- inteiro de entrar no campo por descuido.
create table if not exists public.cartoes (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  instituicao_id    uuid,
  nome              text not null check (length(nome) between 1 and 60),
  apelido           text not null default '' check (length(apelido) <= 40),
  final             text check (final is null or final ~ '^[0-9]{4}$'),
  limite            numeric(14,2) check (limite is null or limite >= 0),
  -- o dia guardado NÃO é truncado: quem trunca é o cálculo do ciclo, mês a
  -- mês. Guardar 28 para um cartão que fecha no último dia perderia a
  -- informação de que ele fecha no último dia.
  dia_fechamento    smallint not null check (dia_fechamento between 1 and 31),
  dia_vencimento    smallint not null check (dia_vencimento between 1 and 31),
  conta_padrao_id   uuid,
  cor               text check (cor is null or cor ~ '^#[0-9A-Fa-f]{6}$'),
  ativo             boolean not null default true,
  obs               text not null default '',
  ordem             integer not null default 0,
  criado_em         timestamptz not null default now(),
  constraint cartao_nome_unico unique (user_id, nome),
  constraint cartoes_dono_id_unico unique (user_id, id)
);

-- Mesma escolha da 002: a checagem de chave estrangeira roda por dentro do
-- banco e NÃO passa por RLS, então a FK precisa carregar o dono para não
-- virar a única porta que aceita apontar para linha alheia.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'cartoes_instituicao_dono_fk') then
    alter table public.cartoes
      add constraint cartoes_instituicao_dono_fk
      foreign key (user_id, instituicao_id) references public.instituicoes (user_id, id)
      on update cascade on delete set null (instituicao_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'cartoes_conta_padrao_dono_fk') then
    alter table public.cartoes
      add constraint cartoes_conta_padrao_dono_fk
      foreign key (user_id, conta_padrao_id) references public.contas (user_id, id)
      on update cascade on delete set null (conta_padrao_id);
  end if;
end $$;

create index if not exists cartoes_user_idx on public.cartoes (user_id, ordem, nome);

alter table public.cartoes enable row level security;
drop policy if exists cartoes_own on public.cartoes;
create policy cartoes_own on public.cartoes
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop trigger if exists cartoes_set_user on public.cartoes;
create trigger cartoes_set_user before insert on public.cartoes
  for each row execute function public.set_user_id();

-- ---------------------------------------------------------------------
-- 2. AS FUNÇÕES DE CICLO
-- ---------------------------------------------------------------------
-- A regra do ciclo é implementada UMA vez, aqui, e não repetida em cada
-- consulta. Ambiguidade de ciclo é a fonte clássica de erro em cartão.

-- Dia `p_dia` do mês `p_mes`, truncado ao último dia quando o mês não tem
-- aquele dia. Fevereiro de ano comum devolve 28; de bissexto, 29.
create or replace function public.dia_no_mes(p_mes text, p_dia int)
returns date language sql immutable set search_path = public as $$
  select primeiro + (least(greatest(p_dia, 1),
                           extract(day from (primeiro + interval '1 month - 1 day'))::int) - 1)
    from (select make_date(left(p_mes, 4)::int, right(p_mes, 2)::int, 1) as primeiro) b;
$$;

-- Em qual competência cai uma compra feita em `p_data`.
--
-- `>=` e não `>`: compra feita no PRÓPRIO dia do fechamento já cai na fatura
-- seguinte, porque o extrato é cortado naquele dia. Com `>`, o app cobraria a
-- compra um mês antes do que o cartão cobra -- e o erro apareceria só no dia
-- do fechamento, uma vez por mês, que é o pior tipo de defeito.
--
-- É a mesma regra que a V1 já usa em js/domain/billing.js. Discordar dela
-- faria as duas metades do app falarem coisas diferentes da mesma compra.
create or replace function public.competencia_da_compra(p_data date, p_fechamento int)
returns text language sql immutable set search_path = public as $$
  select to_char(
    case when p_data < public.dia_no_mes(to_char(p_data, 'YYYY-MM'), p_fechamento)
         then date_trunc('month', p_data)
         else date_trunc('month', p_data) + interval '1 month'
    end, 'YYYY-MM');
$$;

-- As três datas de um ciclo. A janela é MEIO ABERTA: abertura <= D <
-- fechamento. A data de fechamento pertence à competência seguinte.
create or replace function public.ciclo_da_fatura(
  p_competencia text, p_fechamento int, p_vencimento int,
  out abertura date, out fechamento date, out vencimento date)
language sql immutable set search_path = public as $$
  select
    public.dia_no_mes(to_char(public.dia_no_mes(p_competencia, 1) - interval '1 month', 'YYYY-MM'),
                      p_fechamento),
    public.dia_no_mes(p_competencia, p_fechamento),
    public.dia_no_mes(
      to_char(public.dia_no_mes(p_competencia, 1)
              + (case when p_vencimento > p_fechamento then 0 else 1 end) * interval '1 month',
              'YYYY-MM'),
      p_vencimento);
$$;

-- ---------------------------------------------------------------------
-- 3. FATURAS
-- ---------------------------------------------------------------------
-- Guarda só o que NÃO se deriva: qual cartão, qual ciclo, e as três datas
-- já resolvidas. Total, pago e situação são derivados na view -- guardar o
-- total como coluna criaria dois números com o mesmo nome, e eles
-- discordariam no primeiro estorno.
--
-- `competencia` é o ciclo que FECHA naquele mês, e não o mês em que se paga.
-- Um cartão que fecha 25 e vence 8 tem a fatura de competência 2026-09
-- vencendo em 08/10. Por isso a interface nunca rotula fatura com mês solto.
create table if not exists public.faturas (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  cartao_id     uuid not null,
  competencia   text not null check (competencia ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  abertura      date not null,
  fechamento    date not null,
  vencimento    date not null,
  obs           text not null default '',
  criado_em     timestamptz not null default now(),
  constraint fatura_uma_por_ciclo unique (user_id, cartao_id, competencia),
  constraint faturas_dono_id_unico unique (user_id, id),
  constraint fatura_janela_coerente check (abertura < fechamento),
  constraint fatura_vence_depois_de_fechar check (vencimento >= fechamento)
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'faturas_cartao_dono_fk') then
    alter table public.faturas
      add constraint faturas_cartao_dono_fk
      foreign key (user_id, cartao_id) references public.cartoes (user_id, id)
      on update cascade on delete cascade;
  end if;
end $$;

create index if not exists faturas_cartao_idx on public.faturas (user_id, cartao_id, competencia);
create index if not exists faturas_vencimento_idx on public.faturas (user_id, vencimento);

alter table public.faturas enable row level security;
drop policy if exists faturas_own on public.faturas;
create policy faturas_own on public.faturas
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop trigger if exists faturas_set_user on public.faturas;
create trigger faturas_set_user before insert on public.faturas
  for each row execute function public.set_user_id();

-- ---------------------------------------------------------------------
-- 4. COMPRAS DE CARTÃO
-- ---------------------------------------------------------------------
-- Uma compra parcelada é UMA decisão e N obrigações -- a mesma forma da
-- dívida da V1. Esta tabela é a decisão; as parcelas são linhas em
-- `transacoes`, cada uma na sua fatura.
--
-- A V1 identificava parcela por sufixo no id ('_1', '_2'). Aqui é coluna, é
-- inteiro, e é consultável.
create table if not exists public.compras_de_cartao (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  cartao_id       uuid not null,
  categoria_id    uuid,
  descricao       text not null check (length(descricao) between 1 and 120),
  valor_total     numeric(14,2) not null check (valor_total > 0),
  data_compra     date not null,
  total_parcelas  smallint not null default 1 check (total_parcelas between 1 and 72),
  obs             text not null default '',
  criado_em       timestamptz not null default now(),
  constraint compras_dono_id_unico unique (user_id, id)
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'compras_cartao_dono_fk') then
    alter table public.compras_de_cartao
      add constraint compras_cartao_dono_fk
      foreign key (user_id, cartao_id) references public.cartoes (user_id, id)
      on update cascade on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'compras_categoria_dono_fk') then
    alter table public.compras_de_cartao
      add constraint compras_categoria_dono_fk
      foreign key (user_id, categoria_id) references public.categorias (user_id, id)
      on update cascade on delete set null (categoria_id);
  end if;
end $$;

create index if not exists compras_cartao_idx on public.compras_de_cartao (user_id, cartao_id, data_compra);

alter table public.compras_de_cartao enable row level security;
drop policy if exists compras_de_cartao_own on public.compras_de_cartao;
create policy compras_de_cartao_own on public.compras_de_cartao
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop trigger if exists compras_de_cartao_set_user on public.compras_de_cartao;
create trigger compras_de_cartao_set_user before insert on public.compras_de_cartao
  for each row execute function public.set_user_id();

-- ---------------------------------------------------------------------
-- 5. TRANSACOES APRENDE CARTÃO
-- ---------------------------------------------------------------------
alter table public.transacoes add column if not exists fatura_id      uuid;
alter table public.transacoes add column if not exists compra_id      uuid;
alter table public.transacoes add column if not exists parcela        smallint;
alter table public.transacoes add column if not exists total_parcelas smallint;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'transacoes_fatura_dono_fk') then
    alter table public.transacoes
      add constraint transacoes_fatura_dono_fk
      foreign key (user_id, fatura_id) references public.faturas (user_id, id)
      on update cascade on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'transacoes_compra_dono_fk') then
    alter table public.transacoes
      add constraint transacoes_compra_dono_fk
      foreign key (user_id, compra_id) references public.compras_de_cartao (user_id, id)
      on update cascade on delete cascade;
  end if;
end $$;

-- `natureza` ganha o pagamento de fatura. Ele continua sendo uma SAÍDA -- quem
-- dá o sinal é `tipo`, e `natureza` nunca mexe no sinal. O que ela faz é
-- dizer que aquela saída é quitação de obrigação, e não consumo novo.
alter table public.transacoes drop constraint if exists transacoes_natureza_check;
alter table public.transacoes add constraint transacoes_natureza_check
  check (natureza in ('normal','transferencia','estorno','pagamento_de_fatura'));

-- A ASSIMETRIA, escrita como restrição. Sem ela, nada impediria uma linha com
-- conta E fatura, que seria contada nos dois lados.
alter table public.transacoes drop constraint if exists transacao_nao_e_conta_e_fatura;
alter table public.transacoes add constraint transacao_nao_e_conta_e_fatura
  check (fatura_id is null or conta_id is null);

-- Pagamento de fatura sai de uma conta, sempre. Uma quitação que não tirou
-- dinheiro de lugar nenhum não é uma quitação.
alter table public.transacoes drop constraint if exists pagamento_de_fatura_sai_de_conta;
alter table public.transacoes add constraint pagamento_de_fatura_sai_de_conta
  check (natureza <> 'pagamento_de_fatura' or conta_id is not null);

-- Parcela e compra andam juntas, e parcela mora numa fatura.
alter table public.transacoes drop constraint if exists parcela_tem_compra;
alter table public.transacoes add constraint parcela_tem_compra
  check ((compra_id is null) = (parcela is null));

alter table public.transacoes drop constraint if exists parcela_numerada_direito;
alter table public.transacoes add constraint parcela_numerada_direito
  check (parcela is null
         or (parcela >= 1 and total_parcelas is not null and parcela <= total_parcelas));

alter table public.transacoes drop constraint if exists parcela_mora_numa_fatura;
alter table public.transacoes add constraint parcela_mora_numa_fatura
  check (compra_id is null or fatura_id is not null);

alter table public.transacoes drop constraint if exists parcela_unica_por_compra;
alter table public.transacoes add constraint parcela_unica_por_compra
  unique (user_id, compra_id, parcela);

create index if not exists transacoes_fatura_idx on public.transacoes (user_id, fatura_id);
create index if not exists transacoes_compra_idx on public.transacoes (user_id, compra_id);

-- ---------------------------------------------------------------------
-- 6. A PONTE APRENDE FATURA
-- ---------------------------------------------------------------------
-- O contrato da ponte já previa este caso, com o texto "só precisa entrar no
-- check". Era mesmo só isso: o mecanismo de vínculo serve igual, e inventar
-- um segundo seria inventar uma segunda maneira de contar errado.
alter table public.liquidacoes drop constraint if exists liquidacoes_tipo_check;
alter table public.liquidacoes add constraint liquidacoes_tipo_check
  check (tipo in ('divida','fixa','receita','fatura'));

-- ---------------------------------------------------------------------
-- 7. A VIEW QUE RESOLVE A FATURA
-- ---------------------------------------------------------------------
-- `security_invoker` como em `saldos_de_conta`: sem isso a view rodaria com a
-- permissão de quem a criou e entregaria fatura alheia.
--
-- Situação é DERIVADA, e é por isso que apagar o pagamento devolve a fatura
-- para "fechada" sozinho, sem gatilho nenhum.
create or replace view public.faturas_resolvidas
with (security_invoker = on) as
select
  f.id           as fatura_id,
  f.user_id,
  f.cartao_id,
  f.competencia,
  f.abertura,
  f.fechamento,
  f.vencimento,
  f.obs,
  coalesce(sum(t.valor) filter (
    where t.status in ('realizada','conciliada')), 0)::numeric(14,2) as total,
  count(t.id) filter (where t.id is not null)                        as itens,
  coalesce(l.valor, 0)::numeric(14,2)                                as pago,
  l.transacao_id                                                     as pagamento_id,
  case when l.id is not null            then 'paga'
       when current_date >= f.fechamento then 'fechada'
       else 'aberta' end                                             as situacao
from public.faturas f
left join public.transacoes t
       on t.fatura_id = f.id and t.user_id = f.user_id
left join public.liquidacoes l
       on l.user_id = f.user_id and l.tipo = 'fatura' and l.item_id = f.id::text
group by f.id, f.user_id, f.cartao_id, f.competencia, f.abertura, f.fechamento,
         f.vencimento, f.obs, l.id, l.valor, l.transacao_id;

-- ---------------------------------------------------------------------
-- 8. A FATURA NASCE SOB DEMANDA
-- ---------------------------------------------------------------------
-- Nada de gerar doze meses de fatura por cartão. Esta função encontra OU cria
-- a fatura de um ciclo e devolve o id.
--
-- Idempotência garantida pelo BANCO, não pela aplicação: `on conflict do
-- nothing` seguido de nova leitura resolve duas chamadas simultâneas sem
-- criar duas faturas do mesmo ciclo.
create or replace function public.fatura_na_competencia(p_cartao uuid, p_competencia text)
returns uuid language plpgsql security invoker set search_path = public as $$
declare
  c public.cartoes%rowtype;
  ci record;
  achou uuid;
begin
  if auth.uid() is null then
    raise exception 'fatura: é preciso estar logado';
  end if;
  if p_competencia !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'fatura: a competência precisa estar no formato AAAA-MM';
  end if;

  -- o RLS responde "é meu?" sozinho: cartão de outra pessoa não é encontrado
  select * into c from public.cartoes where id = p_cartao;
  if c.id is null then
    raise exception 'fatura: cartão não encontrado';
  end if;

  select id into achou from public.faturas
   where cartao_id = p_cartao and competencia = p_competencia;
  if achou is not null then return achou; end if;

  select * into ci from public.ciclo_da_fatura(p_competencia, c.dia_fechamento, c.dia_vencimento);
  insert into public.faturas (cartao_id, competencia, abertura, fechamento, vencimento)
  values (p_cartao, p_competencia, ci.abertura, ci.fechamento, ci.vencimento)
  on conflict (user_id, cartao_id, competencia) do nothing
  returning id into achou;

  if achou is null then
    select id into achou from public.faturas
     where cartao_id = p_cartao and competencia = p_competencia;
  end if;
  return achou;
end $$;

create or replace function public.fatura_do_cartao(p_cartao uuid, p_data date)
returns uuid language plpgsql security invoker set search_path = public as $$
declare
  c public.cartoes%rowtype;
begin
  select * into c from public.cartoes where id = p_cartao;
  if c.id is null then
    raise exception 'fatura: cartão não encontrado';
  end if;
  return public.fatura_na_competencia(
    p_cartao, public.competencia_da_compra(p_data, c.dia_fechamento));
end $$;

-- ---------------------------------------------------------------------
-- 9. REGISTRAR UMA COMPRA
-- ---------------------------------------------------------------------
-- Uma chamada, uma transação de banco. A compra e as N parcelas nascem
-- juntas ou não nascem -- meia compra parcelada no banco seria pior do que
-- nenhuma, porque pareceria certa.
--
-- OS CENTAVOS: 100,00 em 3 vezes não divide. A diferença vai para a PRIMEIRA
-- parcela (33,34 + 33,33 + 33,33), que é o que os emissores brasileiros
-- fazem. A soma das parcelas é exatamente o valor total, sempre -- a
-- conferência no fim da função é o que garante, e ela aborta se não bater.
create or replace function public.registra_compra_de_cartao(
  p_cartao      uuid,
  p_descricao   text,
  p_valor_total numeric,
  p_data        date,
  p_parcelas    int default 1,
  p_categoria   uuid default null,
  p_obs         text default '')
returns uuid language plpgsql security invoker set search_path = public as $$
declare
  c public.cartoes%rowtype;
  compra uuid;
  comp1 text;
  comp_i text;
  base numeric(14,2);
  sobra numeric(14,2);
  valor_i numeric(14,2);
  soma numeric(14,2) := 0;
  i int;
begin
  if auth.uid() is null then
    raise exception 'compra: é preciso estar logado';
  end if;
  if p_valor_total is null or p_valor_total <= 0 then
    raise exception 'compra: o valor precisa ser maior que zero';
  end if;
  if p_parcelas is null or p_parcelas < 1 or p_parcelas > 72 then
    raise exception 'compra: o número de parcelas precisa ficar entre 1 e 72';
  end if;

  select * into c from public.cartoes where id = p_cartao;
  if c.id is null then
    raise exception 'compra: cartão não encontrado';
  end if;

  insert into public.compras_de_cartao
    (cartao_id, categoria_id, descricao, valor_total, data_compra, total_parcelas, obs)
  values (p_cartao, p_categoria, p_descricao, p_valor_total, p_data, p_parcelas, coalesce(p_obs,''))
  returning id into compra;

  comp1 := public.competencia_da_compra(p_data, c.dia_fechamento);
  base  := trunc(p_valor_total / p_parcelas, 2);
  sobra := p_valor_total - (base * p_parcelas);

  for i in 1..p_parcelas loop
    comp_i := to_char(public.dia_no_mes(comp1, 1) + ((i - 1) * interval '1 month'), 'YYYY-MM');
    valor_i := base + (case when i = 1 then sobra else 0 end);
    soma := soma + valor_i;

    insert into public.transacoes
      (conta_id, fatura_id, compra_id, parcela, total_parcelas, categoria_id, tipo, natureza,
       descricao, valor, data, status, origem, origem_id, obs)
    values
      (null,
       public.fatura_na_competencia(p_cartao, comp_i),
       compra, i, p_parcelas, p_categoria, 'saida', 'normal',
       p_descricao, valor_i,
       -- a data da parcela serve para ordenar e mostrar; quem manda na fatura
       -- é a competência, calculada acima
       (public.dia_no_mes(comp_i, extract(day from p_data)::int)),
       'realizada', 'cartao', compra::text, coalesce(p_obs,''));
  end loop;

  if soma <> p_valor_total then
    raise exception 'compra: as parcelas somam % e o total é %', soma, p_valor_total;
  end if;
  return compra;
end $$;

-- ---------------------------------------------------------------------
-- 10. PAGAR A FATURA
-- ---------------------------------------------------------------------
-- Duas escritas, uma transação: a saída da conta e o vínculo. O vínculo é o
-- MESMO mecanismo da 005 -- a fatura é mais um compromisso, e a ponte já
-- sabia lidar com compromisso.
--
-- A saída leva `natureza='pagamento_de_fatura'` e NÃO leva `fatura_id`: ela
-- não é item da fatura, é a quitação dela. Se levasse, entraria no total e a
-- fatura de 100 passaria a dizer 200.
--
-- Pagamento parcial está fora desta rodada, de propósito: a `unique` da 005
-- recusa a segunda liquidação da mesma fatura, e juros rotativo sem modelo de
-- juros vira número errado com cara de certo. Ver o contrato.
create or replace function public.paga_fatura(
  p_fatura  uuid,
  p_conta   uuid,
  p_valor   numeric,
  p_data    date,
  p_obs     text default '')
returns uuid language plpgsql security invoker set search_path = public as $$
declare
  f public.faturas%rowtype;
  achou int;
  nova uuid;
  -- NÃO se chama `nome`: haveria uma coluna `nome` em `cartoes` e o plpgsql
  -- recusa a ambiguidade em tempo de execução, não de criação. O erro só
  -- apareceria na primeira fatura paga de verdade.
  rotulo text;
begin
  if auth.uid() is null then
    raise exception 'fatura: é preciso estar logado';
  end if;
  if p_conta is null then
    raise exception 'fatura: escolha a conta';
  end if;
  if p_valor is null or p_valor <= 0 then
    raise exception 'fatura: o valor precisa ser maior que zero';
  end if;

  select * into f from public.faturas where id = p_fatura;
  if f.id is null then
    raise exception 'fatura: não encontrada';
  end if;

  select count(*) into achou from public.contas where id = p_conta;
  if achou <> 1 then
    raise exception 'fatura: conta não encontrada';
  end if;

  select coalesce(nullif(apelido,''), nome) into rotulo from public.cartoes where id = f.cartao_id;

  insert into public.transacoes
    (conta_id, categoria_id, tipo, natureza, descricao, valor, data, status,
     origem, origem_id, obs)
  values
    (p_conta, null, 'saida', 'pagamento_de_fatura',
     'Fatura ' || coalesce(rotulo, 'do cartão') || ' · vence ' || to_char(f.vencimento, 'DD/MM'),
     p_valor, p_data, 'realizada', 'cartao', f.id::text, coalesce(p_obs,''))
  returning id into nova;

  insert into public.liquidacoes (tipo, item_id, competencia, transacao_id, valor)
  values ('fatura', f.id::text, f.competencia, nova, p_valor);

  return nova;
end $$;

-- ---------------------------------------------------------------------
-- 11. QUEM PODE CHAMAR
-- ---------------------------------------------------------------------
revoke execute on function public.dia_no_mes(text, int) from public, anon;
revoke execute on function public.competencia_da_compra(date, int) from public, anon;
revoke execute on function public.ciclo_da_fatura(text, int, int) from public, anon;
revoke execute on function public.fatura_na_competencia(uuid, text) from public, anon;
revoke execute on function public.fatura_do_cartao(uuid, date) from public, anon;
revoke execute on function public.registra_compra_de_cartao(uuid, text, numeric, date, int, uuid, text) from public, anon;
revoke execute on function public.paga_fatura(uuid, uuid, numeric, date, text) from public, anon;

grant execute on function public.dia_no_mes(text, int) to authenticated;
grant execute on function public.competencia_da_compra(date, int) to authenticated;
grant execute on function public.ciclo_da_fatura(text, int, int) to authenticated;
grant execute on function public.fatura_na_competencia(uuid, text) to authenticated;
grant execute on function public.fatura_do_cartao(uuid, date) to authenticated;
grant execute on function public.registra_compra_de_cartao(uuid, text, numeric, date, int, uuid, text) to authenticated;
grant execute on function public.paga_fatura(uuid, uuid, numeric, date, text) to authenticated;

-- ---------------------------------------------------------------------
-- 12. CONFERÊNCIA
-- ---------------------------------------------------------------------
select 'cartoes' as objeto, count(*) as linhas from public.cartoes
union all select 'faturas', count(*) from public.faturas
union all select 'compras_de_cartao', count(*) from public.compras_de_cartao;
