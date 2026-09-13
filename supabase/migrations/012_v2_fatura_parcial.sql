-- 012 · PAGAMENTO PARCIAL DE FATURA
--
-- O QUE ESTA MIGRAÇÃO NÃO FAZ, e é a parte mais importante
--
-- Ela NÃO modela crédito rotativo. Não inventa juros, não projeta encargo, não
-- calcula saldo devedor com correção. Fatura de 1.000 com 400 pagos fica com
-- 600 em aberto, e ponto. Juros sem modelo de juros vira número errado com cara
-- de certo, que é o pior defeito que um app de dinheiro pode ter.
--
-- Ela também NÃO cria crédito por pagamento excedente. Pagar mais do que se
-- deve é recusado, não acomodado: acomodar exigiria decidir o que fazer com a
-- sobra, e essa decisão não foi tomada.
--
-- O DEFEITO QUE ELA CONSERTA
--
-- A 005 criou `unique (user_id, tipo, item_id, competencia)` em `liquidacoes`.
-- Para dívida, fixa e receita isso é exatamente certo: um compromisso de uma
-- competência se liquida UMA vez, e é essa unique que impede pagar duas vezes
-- (CASO B do contrato da ponte).
--
-- Para fatura, não. Uma fatura recebe N pagamentos, e a unique recusava o
-- segundo. Por isso `paga_fatura` já aceitava `p_valor` desde a 007 e ainda
-- assim o produto só sabia pagar integralmente: o banco não deixava o resto.
--
-- A CORREÇÃO
--
-- A unique vira ÍNDICE PARCIAL, valendo para tudo menos fatura. O que protegia
-- a ponte continua protegendo; o que travava a fatura sai do caminho.
--
-- No lugar dela, para fatura, entra uma regra diferente porque a pergunta é
-- diferente: não "quantas vezes", e sim "quanto no total". Um gatilho recusa
-- pagamento que faça a soma passar do devido.
--
-- INVARIANTE QUE CONTINUA VALENDO (docs/CONTRATO_CARTAO.md):
--   compra no cartão  = consumo
--   pagamento da fatura = caixa
-- Compra de 1.000 paga em 400 + 600 é 1.000 de consumo e 1.000 de saída de
-- caixa. Nunca 2.000. Fatiar o pagamento não muda nenhum dos dois lados.

begin;

-- ------------------------------------------------- a unique vira parcial --
alter table public.liquidacoes
  drop constraint if exists liquidacao_uma_por_competencia;

-- Constraint não aceita `where`; índice aceita. O nome é o mesmo de propósito:
-- quem for procurar por que a ponte não deixa pagar duas vezes acha no lugar
-- esperado.
drop index if exists public.liquidacao_uma_por_competencia;
create unique index liquidacao_uma_por_competencia
  on public.liquidacoes (user_id, tipo, item_id, competencia)
  where tipo <> 'fatura';

comment on index public.liquidacao_uma_por_competencia is
  'Um compromisso da V1 se liquida uma vez por competência. Fatura fica de fora: ela recebe N pagamentos, e o limite dela é de VALOR, não de contagem.';

-- `liquidacao_uma_por_transacao` continua inteira: uma transação liquida no
-- máximo uma coisa, e isso vale para fatura também.

-- ------------------------------------------------------- quanto se deve --
-- A soma COM SINAL dos itens realizados da fatura. Estorno de uma compra entra
-- como negativo e reduz o devido -- foi a 010 que consertou isso, e a regra
-- precisa ser a mesma aqui e na view, senão o limite de pagamento discorda do
-- número que a tela mostra.
create or replace function public.total_devido_da_fatura(p_fatura uuid)
returns numeric
language sql
stable
set search_path to 'public'
as $fn$
  select coalesce(sum(case when t.tipo = 'entrada' then -t.valor else t.valor end), 0)::numeric(14,2)
    from public.transacoes t
   where t.fatura_id = p_fatura
     and t.status in ('realizada', 'conciliada');
$fn$;

create or replace function public.total_pago_da_fatura(p_fatura uuid)
returns numeric
language sql
stable
set search_path to 'public'
as $fn$
  select coalesce(sum(l.valor), 0)::numeric(14,2)
    from public.liquidacoes l
   where l.tipo = 'fatura' and l.item_id = p_fatura::text;
$fn$;

-- --------------------------------------------- o excesso é BARRADO, não acomodado --
-- Gatilho, e não só um `if` dentro de `paga_fatura`: a regra tem de valer para
-- qualquer caminho que insira em `liquidacoes`, inclusive um insert direto pelo
-- PostgREST. Validação que mora só na função protege só quem passa por ela.
create or replace function public.confere_pagamento_de_fatura()
returns trigger
language plpgsql
set search_path to 'public'
as $fn$
declare
  devido numeric;
  pago numeric;
begin
  if new.tipo <> 'fatura' then
    return new;
  end if;

  devido := public.total_devido_da_fatura(new.item_id::uuid);
  pago := public.total_pago_da_fatura(new.item_id::uuid);

  if pago > devido then
    raise exception 'fatura: o pagamento passa do que se deve. Devido %, já pago %, e esta migração não modela crédito de fatura.',
      devido, pago
      using errcode = 'check_violation';
  end if;

  return new;
end $fn$;

drop trigger if exists confere_pagamento_de_fatura on public.liquidacoes;
-- DIFERIDO até o fim da transação: `paga_fatura` insere a transação e a
-- liquidação em sequência, e um gatilho imediato leria o estado do meio.
create constraint trigger confere_pagamento_de_fatura
  after insert or update on public.liquidacoes
  deferrable initially deferred
  for each row execute function public.confere_pagamento_de_fatura();

-- ------------------------------------------------------------- a view --
-- REESCRITA, e por um motivo de correção, não de gosto: a versão anterior
-- juntava `transacoes` e `liquidacoes` na mesma consulta e agrupava. Com UMA
-- liquidação isso funciona; com N, cada item da fatura aparece N vezes e o
-- `total` sai multiplicado. O pagamento parcial transformaria o total da fatura
-- num número errado sem ninguém mexer no cálculo do total.
--
-- Por isso `pago` vem de subconsulta própria, e não de `join`.
drop view if exists public.faturas_resolvidas;
create view public.faturas_resolvidas
with (security_invoker = true)
as
select
  f.id as fatura_id,
  f.user_id,
  f.cartao_id,
  f.competencia,
  f.abertura,
  f.fechamento,
  f.vencimento,
  f.obs,
  coalesce(i.total, 0)::numeric(14,2) as total,
  coalesce(i.itens, 0) as itens,
  coalesce(p.pago, 0)::numeric(14,2) as pago,
  (coalesce(i.total, 0) - coalesce(p.pago, 0))::numeric(14,2) as restante,
  coalesce(p.pagamentos, 0) as pagamentos,
  case
    -- "paga" exige ter havido o que pagar: fatura vazia não é fatura quitada.
    when coalesce(i.total, 0) > 0 and coalesce(p.pago, 0) >= coalesce(i.total, 0) then 'paga'
    when coalesce(p.pago, 0) > 0 then 'parcial'
    when current_date >= f.fechamento then 'fechada'
    else 'aberta'
  end as situacao
from public.faturas f
left join lateral (
  select sum(case when t.tipo = 'entrada' then -t.valor else t.valor end) as total,
         count(*) as itens
    from public.transacoes t
   where t.fatura_id = f.id
     and t.user_id = f.user_id
     and t.status in ('realizada', 'conciliada')
) i on true
left join lateral (
  select sum(l.valor) as pago, count(*) as pagamentos
    from public.liquidacoes l
   where l.user_id = f.user_id
     and l.tipo = 'fatura'
     and l.item_id = f.id::text
) p on true;

grant select on public.faturas_resolvidas to authenticated;

comment on view public.faturas_resolvidas is
  'A fatura com total, pago, restante e situação já derivados. `pago` vem de subconsulta, e não de join, porque com N pagamentos o join multiplicaria os itens e o total sairia errado.';

-- --------------------------------------------------------- paga_fatura --
-- Ganha a recusa amigável do excesso. O gatilho já barraria, mas com a
-- mensagem do banco; aqui a pessoa lê o que aconteceu e quanto ainda falta.
create or replace function public.paga_fatura(p_fatura uuid, p_conta uuid, p_valor numeric,
                                              p_data date, p_obs text default '')
returns uuid
language plpgsql
set search_path to 'public'
as $fn$
declare
  f public.faturas%rowtype;
  achou int;
  nova uuid;
  devido numeric;
  pago numeric;
  falta numeric;
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

  devido := public.total_devido_da_fatura(f.id);
  pago := public.total_pago_da_fatura(f.id);
  falta := devido - pago;

  if devido <= 0 then
    raise exception 'fatura: não há nada a pagar nesta fatura';
  end if;
  if falta <= 0 then
    raise exception 'fatura: esta fatura já está paga';
  end if;
  if p_valor > falta then
    raise exception 'fatura: falta % e você lançou %. Pagamento acima do devido não é aceito: esta versão não modela crédito de fatura.',
      falta, p_valor
      using errcode = 'check_violation';
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
end $fn$;

-- ------------------------------------------- desfazer UM pagamento só --
-- `desfaz_liquidacao(tipo, item_id, competencia)` apaga tudo daquela
-- competência. Para dívida e fixa isso é o certo -- só existe uma. Para fatura
-- com três pagamentos, apagaria os três, e quem clicou queria desfazer um.
--
-- Esta é a operação PRÓPRIA de desfazer o pagamento de fatura, e é ela que a
-- tela oferece. O botão genérico de estorno não serve aqui: estornar uma saída
-- de caixa criaria uma entrada e deixaria a fatura marcada como paga; o certo é
-- desfazer a operação de origem (§26 do contrato de estorno).
create or replace function public.desfaz_pagamento_de_fatura(p_pagamento uuid)
returns boolean
language plpgsql
set search_path to 'public'
as $fn$
declare
  achou int;
begin
  if auth.uid() is null then
    raise exception 'fatura: é preciso estar logado';
  end if;

  -- O RLS decide o que é visível; pagamento de outra pessoa simplesmente não é
  -- encontrado, e a mensagem é a mesma de um id que não existe.
  select count(*) into achou
    from public.liquidacoes
   where transacao_id = p_pagamento and tipo = 'fatura';
  if achou <> 1 then
    raise exception 'fatura: pagamento não encontrado';
  end if;

  delete from public.liquidacoes where transacao_id = p_pagamento and tipo = 'fatura';
  delete from public.transacoes where id = p_pagamento;

  return true;
end $fn$;

revoke all on function public.total_devido_da_fatura(uuid) from public;
revoke all on function public.total_pago_da_fatura(uuid) from public;
revoke all on function public.paga_fatura(uuid, uuid, numeric, date, text) from public;
revoke all on function public.desfaz_pagamento_de_fatura(uuid) from public;
grant execute on function public.total_devido_da_fatura(uuid) to authenticated;
grant execute on function public.total_pago_da_fatura(uuid) to authenticated;
grant execute on function public.paga_fatura(uuid, uuid, numeric, date, text) to authenticated;
grant execute on function public.desfaz_pagamento_de_fatura(uuid) to authenticated;

commit;
