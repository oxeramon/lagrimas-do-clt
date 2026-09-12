-- =====================================================================
-- TESTES DE CARTÃO E FATURA · contrato da 007
-- =====================================================================
-- Roda inteiro dentro de uma transação e termina em `rollback`.
--
-- Como na 004 e na 005, o miolo roda com `set local role authenticated` e um
-- `request.jwt.claims` montado à mão. Teste de autorização que roda como
-- `postgres` não prova nada: `postgres` é dono e passa por cima de RLS e de
-- grant. As ajudantes são SECURITY INVOKER pelo mesmo motivo.
--
-- Os dois usuários e todos os valores são inventados aqui dentro.
--
-- O CASO A do contrato anti-dupla-contagem é o coração deste arquivo:
-- compra de 100 + pagamento de 100 é 100 de consumo e 100 de caixa. Nunca
-- 200 em lugar nenhum.
-- =====================================================================

begin;

create temporary table resultado (n int, caso text, passou boolean, detalhe text) on commit drop;
create temporary table ids (chave text primary key, valor text) on commit drop;
do $$
begin
  execute format('grant usage on schema %s to authenticated, anon',
                 pg_my_temp_schema()::regnamespace::text);
  execute format('grant select, insert on %s.resultado to authenticated, anon',
                 pg_my_temp_schema()::regnamespace::text);
  execute format('grant select, insert on %s.ids to authenticated, anon',
                 pg_my_temp_schema()::regnamespace::text);
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
    insert into resultado values (n, caso, false, 'ACEITOU quando devia recusar');
  exception when others then
    insert into resultado values (n, caso, true, 'recusado: ' || left(sqlerrm, 70));
  end;
end $$;

-- ---------------------------------------------------------------------
-- cenário: duas pessoas, uma conta e um cartão cada
-- ---------------------------------------------------------------------
insert into auth.users (id) values
  ('11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222222');

insert into public.contas (id, user_id, nome, saldo_inicial, saldo_inicial_em) values
  ('bbbb0001-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','Conta Alfa',1000.00,'2026-01-01'),
  ('bbbb0003-0000-4000-8000-000000000003','22222222-2222-4222-8222-222222222222','Conta do Outro',700.00,'2026-01-01');

-- fecha 25, vence 8: a fatura que fecha em setembro vence em 8 de OUTUBRO
insert into public.cartoes (id, user_id, nome, final, dia_fechamento, dia_vencimento, ordem) values
  ('cccc0001-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','Cartão Exemplo','1234',25,8,10),
  ('cccc0009-0000-4000-8000-000000000009','22222222-2222-4222-8222-222222222222','Cartão Alheio',null,10,20,10);

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111"}';

-- ---------------------------------------------------------------------
-- 1 a 6 · o truncamento do dia, que é do MÊS e não do cartão
-- ---------------------------------------------------------------------
select pg_temp.confere(1,'dia 31 em fevereiro comum vira 28',
  public.dia_no_mes('2026-02', 31), '2026-02-28'::date);
select pg_temp.confere(2,'dia 31 em fevereiro bissexto vira 29',
  public.dia_no_mes('2028-02', 31), '2028-02-29'::date);
select pg_temp.confere(3,'dia 31 em abril vira 30',
  public.dia_no_mes('2026-04', 31), '2026-04-30'::date);
select pg_temp.confere(4,'dia 31 em janeiro continua 31',
  public.dia_no_mes('2026-01', 31), '2026-01-31'::date);
select pg_temp.confere(5,'dia 30 em fevereiro comum vira 28',
  public.dia_no_mes('2026-02', 30), '2026-02-28'::date);
select pg_temp.confere(6,'dia normal não é tocado',
  public.dia_no_mes('2026-09', 25), '2026-09-25'::date);

-- ---------------------------------------------------------------------
-- 7 a 13 · em qual fatura cai a compra
-- ---------------------------------------------------------------------
select pg_temp.confere(7,'compra ANTES do fechamento cai na fatura do mês',
  public.competencia_da_compra('2026-09-24', 25), '2026-09');
select pg_temp.confere(8,'compra NO DIA do fechamento cai na fatura seguinte',
  public.competencia_da_compra('2026-09-25', 25), '2026-10');
select pg_temp.confere(9,'compra DEPOIS do fechamento cai na fatura seguinte',
  public.competencia_da_compra('2026-09-26', 25), '2026-10');
select pg_temp.confere(10,'dezembro vira janeiro do ano seguinte',
  public.competencia_da_compra('2026-12-28', 25), '2027-01');
select pg_temp.confere(11,'fechamento 31 em fevereiro: dia 27 ainda é de fevereiro',
  public.competencia_da_compra('2026-02-27', 31), '2026-02');
select pg_temp.confere(12,'fechamento 31 em fevereiro: dia 28 já é de março',
  public.competencia_da_compra('2026-02-28', 31), '2026-03');
select pg_temp.confere(13,'fevereiro bissexto: dia 28 ainda é de fevereiro',
  public.competencia_da_compra('2028-02-28', 31), '2028-02');

-- ---------------------------------------------------------------------
-- 14 a 20 · as três datas do ciclo
-- ---------------------------------------------------------------------
select pg_temp.confere(14,'fecha 25 e vence 8: vence no mês SEGUINTE',
  (select vencimento from public.ciclo_da_fatura('2026-09', 25, 8)), '2026-10-08'::date);
select pg_temp.confere(15,'e fecha no próprio mês',
  (select fechamento from public.ciclo_da_fatura('2026-09', 25, 8)), '2026-09-25'::date);
select pg_temp.confere(16,'a abertura é o fechamento anterior: a janela é meio aberta',
  (select abertura from public.ciclo_da_fatura('2026-09', 25, 8)), '2026-08-25'::date);
select pg_temp.confere(17,'fecha 10 e vence 20: vence no MESMO mês',
  (select vencimento from public.ciclo_da_fatura('2026-09', 10, 20)), '2026-09-20'::date);
select pg_temp.confere(18,'dezembro vence em janeiro',
  (select vencimento from public.ciclo_da_fatura('2026-12', 25, 8)), '2027-01-08'::date);
select pg_temp.confere(19,'fechamento 31 numa competência de fevereiro bissexto',
  (select fechamento from public.ciclo_da_fatura('2028-02', 31, 10)), '2028-02-29'::date);
select pg_temp.confere(20,'vencimento 31 num mês de 30 dias vira 30',
  (select vencimento from public.ciclo_da_fatura('2026-04', 25, 31)), '2026-04-30'::date);

-- ---------------------------------------------------------------------
-- 21 a 24 · o cartão guarda quatro dígitos, e só
-- ---------------------------------------------------------------------
-- Mais de quatro dígitos é recusado. O teste NÃO escreve um número de cartão,
-- nem de mentira: a auditoria de repositório público barra qualquer sequência
-- com cara de cartão, e ela está certa -- este repositório é público, e a
-- regra não abre exceção para "é só um teste". Cinco dígitos provam a mesma
-- coisa que dezesseis.
select pg_temp.deve_falhar(21,'mais de quatro dígitos no campo de final é recusado', $cmd$
  insert into public.cartoes (nome, final, dia_fechamento, dia_vencimento)
  values ('Recusado','12345',10,20) $cmd$);
select pg_temp.deve_falhar(22,'final com letra é recusado', $cmd$
  insert into public.cartoes (nome, final, dia_fechamento, dia_vencimento)
  values ('Recusado','12a4',10,20) $cmd$);
insert into public.cartoes (id, nome, final, dia_fechamento, dia_vencimento)
values ('cccc0002-0000-4000-8000-000000000002','Cartão Sem Final', null, 10, 20);
select pg_temp.confere(23,'cartão sem final é aceito: o campo é opcional',
  (select count(*) from public.cartoes where final is null), 1::bigint);
select pg_temp.confere(24,'e o cartão alheio não aparece',
  (select count(*) from public.cartoes), 2::bigint);

-- ---------------------------------------------------------------------
-- 25 a 28 · a fatura nasce sob demanda, e uma vez só
-- ---------------------------------------------------------------------
insert into ids
select 'f_set', public.fatura_na_competencia('cccc0001-0000-4000-8000-000000000001','2026-09')::text;
select pg_temp.confere(25,'a fatura do ciclo é criada',
  (select count(*) from public.faturas where competencia='2026-09'), 1::bigint);
select pg_temp.confere(26,'chamar de novo devolve a MESMA fatura, não cria outra',
  public.fatura_na_competencia('cccc0001-0000-4000-8000-000000000001','2026-09')::text,
  (select valor from ids where chave='f_set'));
select pg_temp.confere(27,'e continua existindo uma só',
  (select count(*) from public.faturas), 1::bigint);
select pg_temp.deve_falhar(28,'fatura de cartão alheio é recusada', $cmd$
  select public.fatura_na_competencia('cccc0009-0000-4000-8000-000000000009','2026-09') $cmd$);

-- ---------------------------------------------------------------------
-- 29 a 36 · compra parcelada: uma decisão, N obrigações com identidade
-- ---------------------------------------------------------------------
insert into ids
select 'compra', public.registra_compra_de_cartao(
  'cccc0001-0000-4000-8000-000000000001','Compra Parcelada', 100.00, '2026-09-10', 3,
  null, '')::text;

select pg_temp.confere(29,'a compra lógica é UMA linha',
  (select count(*) from public.compras_de_cartao), 1::bigint);
select pg_temp.confere(30,'e ela virou três parcelas',
  (select count(*) from public.transacoes where compra_id = (select valor from ids where chave='compra')::uuid),
  3::bigint);
select pg_temp.confere(31,'a soma das parcelas é exatamente o total',
  (select sum(valor) from public.transacoes where compra_id = (select valor from ids where chave='compra')::uuid),
  100.00::numeric);
select pg_temp.confere(32,'a sobra de centavos vai para a PRIMEIRA parcela',
  (select valor from public.transacoes
    where compra_id = (select valor from ids where chave='compra')::uuid and parcela = 1),
  33.34::numeric);
select pg_temp.confere(33,'as demais ficam iguais',
  (select valor from public.transacoes
    where compra_id = (select valor from ids where chave='compra')::uuid and parcela = 3),
  33.33::numeric);
select pg_temp.confere(34,'a parcela sabe quem é, por coluna e não por sufixo de texto',
  (select parcela::text || '/' || total_parcelas::text from public.transacoes
    where compra_id = (select valor from ids where chave='compra')::uuid and parcela = 2),
  '2/3');
select pg_temp.confere(35,'cada parcela caiu numa fatura diferente',
  (select count(distinct fatura_id) from public.transacoes
    where compra_id = (select valor from ids where chave='compra')::uuid), 3::bigint);
select pg_temp.confere(36,'e as faturas são de ciclos consecutivos',
  (select string_agg(f.competencia, ',' order by f.competencia)
     from public.faturas f
    where f.id in (select fatura_id from public.transacoes
                    where compra_id = (select valor from ids where chave='compra')::uuid)),
  '2026-09,2026-10,2026-11');

-- ---------------------------------------------------------------------
-- 37 a 39 · compra no cartão NÃO é caixa
-- ---------------------------------------------------------------------
select pg_temp.confere(37,'nenhuma parcela tem conta: nada saiu de conta nenhuma',
  (select count(*) from public.transacoes where compra_id is not null and conta_id is not null),
  0::bigint);
select pg_temp.confere(38,'o saldo da conta não se mexeu com a compra',
  (select saldo from public.saldos_de_conta where conta_id='bbbb0001-0000-4000-8000-000000000001'),
  1000.00::numeric);
select pg_temp.confere(39,'mas o consumo do período já conta a compra',
  (select coalesce(sum(valor),0) from public.transacoes
    where tipo='saida' and natureza='normal' and status in ('realizada','conciliada')),
  100.00::numeric);

-- ---------------------------------------------------------------------
-- 40 a 44 · CASO A · a prova que dá nome a esta rodada
--   compra 100 + pagamento 100 = 100 de consumo e 100 de caixa. Nunca 200.
-- ---------------------------------------------------------------------
-- uma compra à vista de 100 numa fatura só, para o caso ficar limpo
insert into ids
select 'f_caso_a', public.fatura_na_competencia('cccc0002-0000-4000-8000-000000000002','2026-09')::text;
insert into ids
select 'compra_a', public.registra_compra_de_cartao(
  'cccc0002-0000-4000-8000-000000000002','Compra do Caso A', 100.00, '2026-09-05', 1,
  null, '')::text;

select pg_temp.confere(40,'a fatura do caso A tem 100 de total',
  (select total from public.faturas_resolvidas where fatura_id = (select valor from ids where chave='f_caso_a')::uuid),
  100.00::numeric);
select pg_temp.confere(41,'e está fechada, porque a data já passou',
  (select situacao from public.faturas_resolvidas where fatura_id = (select valor from ids where chave='f_caso_a')::uuid),
  'fechada');

insert into ids
select 'pg_a', public.paga_fatura(
  (select valor from ids where chave='f_caso_a')::uuid,
  'bbbb0001-0000-4000-8000-000000000001', 100.00, '2026-09-20', '')::text;

select pg_temp.confere(42,'CASO A · o consumo continua 200 no total das duas compras, não 300',
  (select coalesce(sum(valor),0) from public.transacoes
    where tipo='saida' and natureza='normal' and status in ('realizada','conciliada')),
  200.00::numeric);
select pg_temp.confere(43,'CASO A · o caixa registrou 100, uma vez só',
  (select coalesce(sum(valor),0) from public.transacoes
    where tipo='saida' and conta_id is not null and status in ('realizada','conciliada')),
  100.00::numeric);
select pg_temp.confere(44,'CASO A · e o saldo da conta caiu exatamente 100',
  (select saldo from public.saldos_de_conta where conta_id='bbbb0001-0000-4000-8000-000000000001'),
  900.00::numeric);

-- ---------------------------------------------------------------------
-- 45 a 50 · o que o pagamento é, e o que ele não é
-- ---------------------------------------------------------------------
select pg_temp.confere(45,'o pagamento NÃO é item da fatura',
  (select fatura_id from public.transacoes where id = (select valor from ids where chave='pg_a')::uuid),
  null::uuid);
select pg_temp.confere(46,'e por isso o total da fatura continua 100',
  (select total from public.faturas_resolvidas where fatura_id = (select valor from ids where chave='f_caso_a')::uuid),
  100.00::numeric);
select pg_temp.confere(47,'a fatura ficou paga',
  (select situacao from public.faturas_resolvidas where fatura_id = (select valor from ids where chave='f_caso_a')::uuid),
  'paga');
select pg_temp.confere(48,'e sabe quanto foi pago',
  (select pago from public.faturas_resolvidas where fatura_id = (select valor from ids where chave='f_caso_a')::uuid),
  100.00::numeric);
select pg_temp.deve_falhar(49,'pagar a mesma fatura duas vezes é recusado', $cmd$
  select public.paga_fatura((select valor from ids where chave='f_caso_a')::uuid,
    'bbbb0001-0000-4000-8000-000000000001', 100.00, '2026-09-21', '') $cmd$);
select pg_temp.confere(50,'o pagamento tem natureza própria, e não some no meio dos gastos',
  (select natureza from public.transacoes where id = (select valor from ids where chave='pg_a')::uuid),
  'pagamento_de_fatura');

-- ---------------------------------------------------------------------
-- 51 a 53 · desfazer o pagamento devolve tudo ao lugar
--   a situação é DERIVADA, então não há gatilho nenhum para reabrir a fatura
-- ---------------------------------------------------------------------
delete from public.transacoes where id = (select valor from ids where chave='pg_a')::uuid;
select pg_temp.confere(51,'apagar o pagamento apaga o vínculo pelo cascade',
  (select count(*) from public.liquidacoes where tipo='fatura'), 0::bigint);
select pg_temp.confere(52,'e a fatura volta sozinha para fechada',
  (select situacao from public.faturas_resolvidas where fatura_id = (select valor from ids where chave='f_caso_a')::uuid),
  'fechada');
select pg_temp.confere(53,'o saldo da conta volta ao que era',
  (select saldo from public.saldos_de_conta where conta_id='bbbb0001-0000-4000-8000-000000000001'),
  1000.00::numeric);

-- ---------------------------------------------------------------------
-- 54 a 57 · as restrições que tornam a dupla contagem inescrevível
-- ---------------------------------------------------------------------
select pg_temp.deve_falhar(54,'transação com conta E fatura é recusada', $cmd$
  insert into public.transacoes (conta_id, fatura_id, tipo, natureza, descricao, valor, data, status)
  values ('bbbb0001-0000-4000-8000-000000000001',
          (select valor from ids where chave='f_caso_a')::uuid,
          'saida','normal','impossível',10,'2026-09-10','realizada') $cmd$);
select pg_temp.deve_falhar(55,'pagamento de fatura sem conta é recusado', $cmd$
  insert into public.transacoes (tipo, natureza, descricao, valor, data, status)
  values ('saida','pagamento_de_fatura','sem conta',10,'2026-09-10','realizada') $cmd$);
select pg_temp.deve_falhar(56,'parcela sem fatura é recusada', $cmd$
  insert into public.transacoes (compra_id, parcela, total_parcelas, tipo, natureza, descricao, valor, data, status)
  values ((select valor from ids where chave='compra')::uuid, 9, 9,
          'saida','normal','parcela solta',10,'2026-09-10','realizada') $cmd$);
select pg_temp.deve_falhar(57,'parcela maior que o total é recusada', $cmd$
  insert into public.transacoes (compra_id, parcela, total_parcelas, fatura_id, tipo, natureza, descricao, valor, data, status)
  values ((select valor from ids where chave='compra')::uuid, 5, 3,
          (select valor from ids where chave='f_set')::uuid,
          'saida','normal','parcela impossível',10,'2026-09-10','realizada') $cmd$);

-- ---------------------------------------------------------------------
-- 58 a 60 · valor e conta alheia
-- ---------------------------------------------------------------------
select pg_temp.deve_falhar(58,'pagar com valor zero é recusado', $cmd$
  select public.paga_fatura((select valor from ids where chave='f_set')::uuid,
    'bbbb0001-0000-4000-8000-000000000001', 0, '2026-09-21', '') $cmd$);
select pg_temp.deve_falhar(59,'pagar com conta alheia é recusado', $cmd$
  select public.paga_fatura((select valor from ids where chave='f_set')::uuid,
    'bbbb0003-0000-4000-8000-000000000003', 50.00, '2026-09-21', '') $cmd$);
select pg_temp.deve_falhar(60,'compra em cartão alheio é recusada', $cmd$
  select public.registra_compra_de_cartao('cccc0009-0000-4000-8000-000000000009',
    'invasão', 10.00, '2026-09-10', 1, null, '') $cmd$);

-- ---------------------------------------------------------------------
-- 61 a 65 · o outro usuário e o anônimo
-- ---------------------------------------------------------------------
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222"}';
select pg_temp.confere(61,'o outro usuário não enxerga fatura alheia',
  (select count(*) from public.faturas), 0::bigint);
select pg_temp.confere(62,'nem compra alheia',
  (select count(*) from public.compras_de_cartao), 0::bigint);
select pg_temp.confere(63,'e a view respeita o RLS de quem chama',
  (select count(*) from public.faturas_resolvidas), 0::bigint);

reset role;
set local role anon;
set local request.jwt.claims = '';
select pg_temp.confere(64,'anon não enxerga cartão nenhum',
  (select count(*) from public.cartoes), 0::bigint);
select pg_temp.deve_falhar(65,'anon não executa paga_fatura', $cmd$
  select public.paga_fatura('cccc0001-0000-4000-8000-000000000001',
    'bbbb0001-0000-4000-8000-000000000001', 10.00, '2026-09-21', '') $cmd$);
select pg_temp.deve_falhar(66,'anon não executa registra_compra_de_cartao', $cmd$
  select public.registra_compra_de_cartao('cccc0001-0000-4000-8000-000000000001',
    'x', 10.00, '2026-09-10', 1, null, '') $cmd$);
select pg_temp.deve_falhar(67,'anon não executa fatura_na_competencia', $cmd$
  select public.fatura_na_competencia('cccc0001-0000-4000-8000-000000000001','2026-09') $cmd$);

reset role;
select n, case when passou then 'ok' else 'FALHOU' end as situacao, caso, detalhe
  from resultado order by n;

rollback;
