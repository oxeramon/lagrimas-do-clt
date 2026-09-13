-- =====================================================================
-- TESTES DE ESTORNO · contrato da 010
-- =====================================================================
-- Roda inteiro dentro de uma transação e termina em `rollback`.
--
-- O contrato está em docs/CONTRATO_ESTORNO.md e foi escrito antes do SQL.
-- Duas coisas importam mais que as outras:
--
--   1. os três "não" -- transferência, pagamento de fatura e liquidação da V1
--      não se estornam, se desfazem. Quem recusa é o BANCO;
--   2. estorno de compra no cartão volta PARA A FATURA, e o total dela precisa
--      ir a zero. Este é o caso que revelou que a soma da 007 não tinha sinal.
--
-- O gatilho do estorno é postergado, como o do rateio na 009, então o
-- `deve_falhar` daqui também chama `set constraints all immediate`.
-- =====================================================================

begin;

create temporary table resultado (n int, caso text, passou boolean, detalhe text) on commit drop;
create temporary table ids (chave text primary key, valor text) on commit drop;
do $$
begin
  execute format('grant usage on schema %s to authenticated, anon', pg_my_temp_schema()::regnamespace::text);
  execute format('grant select, insert on %s.resultado to authenticated, anon', pg_my_temp_schema()::regnamespace::text);
  execute format('grant select, insert on %s.ids to authenticated, anon', pg_my_temp_schema()::regnamespace::text);
end $$;

create function pg_temp.confere(n int, caso text, obtido anyelement, esperado anyelement)
returns void language plpgsql as $$
begin
  insert into resultado values (n, caso, obtido is not distinct from esperado,
    'obtido ' || coalesce(obtido::text,'null') || ' · esperado ' || coalesce(esperado::text,'null'));
end $$;

create function pg_temp.deve_falhar(n int, caso text, comando text)
returns void language plpgsql as $$
begin
  begin
    execute comando;
    set constraints all immediate;
    insert into resultado values (n, caso, false, 'ACEITOU quando devia recusar');
  exception when others then
    insert into resultado values (n, caso, true, 'recusado: ' || left(sqlerrm, 70));
  end;
  set constraints all deferred;
end $$;

insert into auth.users (id) values ('11111111-1111-4111-8111-111111111111');
insert into public.contas (id, user_id, nome, saldo_inicial, saldo_inicial_em) values
  ('bbbb0001-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','Conta Alfa',1000.00,'2026-01-01'),
  ('bbbb0002-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111','Conta Beta',500.00,'2026-01-01');
insert into public.cartoes (id, user_id, nome, dia_fechamento, dia_vencimento) values
  ('cccc0001-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','Cartão Exemplo',10,20);
insert into public.fixas (id, user_id, nome, valor, obs, ordem, categoria, meio, credor) values
  ('ffff0001-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','Conta Fixa',120.00,'',10,'Moradia','Boleto','');

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111"}';

-- ---------------------------------------------------------------------
-- 1 a 13 · parcial, múltiplo, e o teto que não se ultrapassa
-- ---------------------------------------------------------------------
insert into public.transacoes (id, conta_id, tipo, natureza, descricao, valor, data, status)
values ('aaaa1111-0000-4000-8000-000000000001','bbbb0001-0000-4000-8000-000000000001',
        'saida','normal','Compra Exemplo',100.00,'2026-09-05','realizada');

select pg_temp.confere(1,'antes de estornar, o estornável é o valor inteiro',
  (select estornavel from public.transacoes_com_estorno where transacao_id='aaaa1111-0000-4000-8000-000000000001'),
  100.00::numeric);
select pg_temp.confere(2,'e a transação aceita estorno',
  (select pode_estornar from public.transacoes_com_estorno where transacao_id='aaaa1111-0000-4000-8000-000000000001'),
  true);

insert into ids select 'e1', public.estorna_transacao('aaaa1111-0000-4000-8000-000000000001', 40.00, '2026-09-08','')::text;
set constraints all immediate;
set constraints all deferred;
select pg_temp.confere(3,'estorno parcial é aceito',
  (select valor from public.transacoes where id=(select valor from ids where chave='e1')::uuid), 40.00::numeric);
select pg_temp.confere(4,'e o sinal inverteu: estorno de saída é entrada',
  (select tipo from public.transacoes where id=(select valor from ids where chave='e1')::uuid), 'entrada');
select pg_temp.confere(5,'ele herda a conta do original',
  (select conta_id::text from public.transacoes where id=(select valor from ids where chave='e1')::uuid),
  'bbbb0001-0000-4000-8000-000000000001');
select pg_temp.confere(6,'sobra estornar o resto',
  (select estornavel from public.transacoes_com_estorno where transacao_id='aaaa1111-0000-4000-8000-000000000001'),
  60.00::numeric);
select pg_temp.confere(7,'o saldo da conta já voltou os 40',
  (select saldo from public.saldos_de_conta where conta_id='bbbb0001-0000-4000-8000-000000000001'),
  940.00::numeric);

insert into ids select 'e2', public.estorna_transacao('aaaa1111-0000-4000-8000-000000000001', null, '2026-09-09','')::text;
set constraints all immediate;
set constraints all deferred;
select pg_temp.confere(8,'sem valor, estorna o que falta',
  (select valor from public.transacoes where id=(select valor from ids where chave='e2')::uuid), 60.00::numeric);
select pg_temp.confere(9,'vários estornos da mesma transação são permitidos',
  (select count(*) from public.transacoes where estorno_de_id='aaaa1111-0000-4000-8000-000000000001'), 2::bigint);
select pg_temp.confere(10,'agora não sobra nada para estornar',
  (select estornavel from public.transacoes_com_estorno where transacao_id='aaaa1111-0000-4000-8000-000000000001'),
  0.00::numeric);
select pg_temp.confere(11,'e o saldo da conta voltou ao que era',
  (select saldo from public.saldos_de_conta where conta_id='bbbb0001-0000-4000-8000-000000000001'),
  1000.00::numeric);
select pg_temp.deve_falhar(12,'estornar de novo é recusado: já voltou por inteiro', $cmd$
  select public.estorna_transacao('aaaa1111-0000-4000-8000-000000000001') $cmd$);
select pg_temp.deve_falhar(13,'e a soma dos estornos nunca passa do original', $cmd$
  insert into public.transacoes (conta_id, tipo, natureza, estorno_de_id, descricao, valor, data, status)
  values ('bbbb0001-0000-4000-8000-000000000001','entrada','estorno',
          'aaaa1111-0000-4000-8000-000000000001','a mais',1.00,'2026-09-10','realizada') $cmd$);

-- ---------------------------------------------------------------------
-- 14 · simetria
-- ---------------------------------------------------------------------
insert into public.transacoes (id, conta_id, tipo, natureza, descricao, valor, data, status)
values ('aaaa1111-0000-4000-8000-000000000002','bbbb0001-0000-4000-8000-000000000001',
        'entrada','normal','Recebimento Exemplo',200.00,'2026-09-05','realizada');
insert into ids select 'e3', public.estorna_transacao('aaaa1111-0000-4000-8000-000000000002', null, '2026-09-08','')::text;
set constraints all immediate;
set constraints all deferred;
select pg_temp.confere(14,'estorno de entrada vira saída',
  (select tipo from public.transacoes where id=(select valor from ids where chave='e3')::uuid), 'saida');

-- ---------------------------------------------------------------------
-- 15 a 18 · OS TRÊS "NÃO", e o estorno de estorno
-- ---------------------------------------------------------------------
select public.cria_transferencia('bbbb0001-0000-4000-8000-000000000001','bbbb0002-0000-4000-8000-000000000002',
  50.00,'2026-09-06','Transferência','','realizada');
select pg_temp.deve_falhar(15,'transferência NÃO se estorna, se desfaz', $cmd$
  select public.estorna_transacao((select id from public.transacoes
    where natureza='transferencia' and tipo='saida' limit 1)) $cmd$);

insert into ids select 'liq', public.liquida_compromisso(
  'fixa','fx:ffff0001-0000-4000-8000-000000000001','2026-09',
  'bbbb0001-0000-4000-8000-000000000001', 120.00, '2026-09-10','Conta fixa', null, '')::text;
select pg_temp.deve_falhar(16,'transação que quita obrigação NÃO se estorna', $cmd$
  select public.estorna_transacao((select valor from ids where chave='liq')::uuid) $cmd$);

select pg_temp.deve_falhar(17,'estorno de estorno é recusado', $cmd$
  select public.estorna_transacao((select valor from ids where chave='e1')::uuid) $cmd$);
select pg_temp.deve_falhar(18,'estorno com o MESMO sinal do original é recusado', $cmd$
  insert into public.transacoes (conta_id, tipo, natureza, estorno_de_id, descricao, valor, data, status)
  values ('bbbb0001-0000-4000-8000-000000000001','entrada','estorno',
          'aaaa1111-0000-4000-8000-000000000002','sinal errado',10.00,'2026-09-10','realizada') $cmd$);

-- ---------------------------------------------------------------------
-- 19 a 22 · O CASO QUE REVELOU O DEFEITO DA 007
--   estorno de compra no cartão volta para a FATURA. Sem sinal na soma, a
--   fatura de 100 com estorno de 100 diria 200.
-- ---------------------------------------------------------------------
insert into ids select 'compra', public.registra_compra_de_cartao(
  'cccc0001-0000-4000-8000-000000000001','Compra no Cartão', 100.00, '2026-09-05', 1, null, '')::text;
insert into ids select 'f', (select fatura_id::text from public.faturas_resolvidas limit 1);
select pg_temp.confere(19,'a fatura tem 100 antes do estorno',
  (select total from public.faturas_resolvidas where fatura_id=(select valor from ids where chave='f')::uuid),
  100.00::numeric);
select public.estorna_transacao((select id from public.transacoes
  where compra_id=(select valor from ids where chave='compra')::uuid), null, '2026-09-07','');
set constraints all immediate;
set constraints all deferred;
select pg_temp.confere(20,'estorno de compra no cartão volta PARA A FATURA, não para a conta',
  (select count(*) from public.transacoes where natureza='estorno' and fatura_id is not null), 1::bigint);
select pg_temp.confere(21,'e o total da fatura vira ZERO, não 200',
  (select total from public.faturas_resolvidas where fatura_id=(select valor from ids where chave='f')::uuid),
  0.00::numeric);
-- A conta: 1000 − 100 (compra) + 40 + 60 (estornos) + 200 (recebimento)
--          − 200 (estorno dele) − 50 (transferência) − 120 (conta fixa) = 830.
-- A compra no cartão e o estorno dela não passam por conta nenhuma.
select pg_temp.confere(22,'nem a compra no cartão nem o estorno dela tocam a conta',
  (select saldo from public.saldos_de_conta where conta_id='bbbb0001-0000-4000-8000-000000000001'),
  830.00::numeric);

-- ---------------------------------------------------------------------
-- 23 a 25 · o que a tela precisa saber antes de oferecer o botão
-- ---------------------------------------------------------------------
select pg_temp.confere(23,'transação com vínculo não aparece como estornável',
  (select pode_estornar from public.transacoes_com_estorno
    where transacao_id=(select valor from ids where chave='liq')::uuid), false);
select pg_temp.confere(24,'nem a perna de uma transferência',
  (select bool_or(pode_estornar) from public.transacoes_com_estorno c
    join public.transacoes t on t.id = c.transacao_id where t.natureza='transferencia'), false);

reset role;
set local role anon;
set local request.jwt.claims = '';
select pg_temp.deve_falhar(25,'anon não executa estorna_transacao', $cmd$
  select public.estorna_transacao('aaaa1111-0000-4000-8000-000000000001') $cmd$);

reset role;
select count(*) filter (where passou) as passaram,
       count(*) filter (where not passou) as falharam,
       coalesce(string_agg(n::text || ' ' || caso || ' :: ' || detalhe, ' | ')
                filter (where not passou), '(nenhuma)') as falhas
  from resultado;

rollback;
