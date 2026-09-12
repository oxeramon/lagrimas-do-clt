-- =====================================================================
-- TESTES DA PONTE V1 ↔ V2 · contrato da 005
-- =====================================================================
-- Roda inteiro dentro de uma transação e termina em `rollback`.
--
-- Como na 004, o miolo roda com `set local role authenticated` e um
-- `request.jwt.claims` montado à mão. Teste de autorização que roda como
-- `postgres` não prova nada: `postgres` é dono e passa por cima de RLS e de
-- grant. As ajudantes são SECURITY INVOKER pelo mesmo motivo.
--
-- Os dois usuários e todos os valores são inventados aqui dentro.
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
-- cenário: duas pessoas, contas, um compromisso de cada tipo
-- ---------------------------------------------------------------------
insert into auth.users (id) values
  ('11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222222');

insert into public.contas (id, user_id, nome, saldo_inicial, saldo_inicial_em) values
  ('bbbb0001-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','Conta Alfa',2000.00,'2026-01-01'),
  ('bbbb0003-0000-4000-8000-000000000003','22222222-2222-4222-8222-222222222222','Conta do Outro',700.00,'2026-01-01');

insert into public.dividas (id, user_id, credor, descricao, categoria, valor,
                            parcela_inicial, total_parcelas, mes_inicial, obs, ordem, meio)
values ('eeee0001-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111',
        'Credor Exemplo','Compromisso Exemplo','Outros',500.00,1,3,'2026-09','',10,'Boleto'),
       ('eeee0009-0000-4000-8000-000000000009','22222222-2222-4222-8222-222222222222',
        'Credor Alheio','Compromisso Alheio','Outros',100.00,1,1,'2026-09','',10,'Boleto');

insert into public.fixas (id, user_id, nome, valor, obs, ordem, categoria, meio, credor)
values ('ffff0001-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111',
        'Conta Fixa Exemplo',120.00,'',10,'Moradia','Boleto','');

insert into public.receitas (id, user_id, descricao, categoria, valor, tipo, mes_inicial, obs, ordem)
values ('aaaa0001-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111',
        'Receita Exemplo','Extra',1000.00,'mensal','2026-09','',10);

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111"}';

-- ---------------------------------------------------------------------
-- 1 a 6 · CASO B do contrato anti-dupla-contagem
--   dívida de 500, paga por uma saída de 500.
--   Compromisso realizado = 500. Movimento = 500. Consolidado = 500.
-- ---------------------------------------------------------------------
insert into ids
select 'tx_divida', public.liquida_compromisso(
  'divida','eeee0001-0000-4000-8000-000000000001','2026-09',
  'bbbb0001-0000-4000-8000-000000000001', 500.00, '2026-09-12',
  'Pagamento do compromisso', null, '')::text;

select pg_temp.confere(1,'liquidar cria UMA transação de saída',
  (select count(*) from public.transacoes where tipo='saida' and valor=500.00), 1::bigint);
select pg_temp.confere(2,'a transação sai da conta escolhida',
  (select conta_id::text from public.transacoes where valor=500.00),
  'bbbb0001-0000-4000-8000-000000000001');
select pg_temp.confere(3,'a procedência fica registrada na transação',
  (select origem||'/'||origem_id from public.transacoes where valor=500.00),
  'divida/eeee0001-0000-4000-8000-000000000001');
select pg_temp.confere(4,'a marca de pago da V1 foi criada',
  (select count(*) from public.pagamentos
    where mes='2026-09' and item_id='eeee0001-0000-4000-8000-000000000001'), 1::bigint);
select pg_temp.confere(5,'o vínculo existe e aponta para a transação',
  (select count(*) from public.liquidacoes l join public.transacoes t on t.id = l.transacao_id
    where l.tipo='divida' and l.competencia='2026-09' and t.valor=500.00), 1::bigint);
-- 2000 − 500
select pg_temp.confere(6,'o saldo da conta caiu uma vez só, não duas',
  (select saldo from public.saldos_de_conta where conta_id='bbbb0001-0000-4000-8000-000000000001'),
  1500.00::numeric);

-- ---------------------------------------------------------------------
-- 7 · O NÚMERO QUE NÃO PODE DOBRAR
--   "compromissos liquidados" e "saídas realizadas" são a MESMA coisa vista
--   dos dois lados. Somar os dois dá 1.000 para uma dívida de 500.
-- ---------------------------------------------------------------------
select pg_temp.confere(7,'liquidado e movimentado são o mesmo dinheiro, não a soma',
  (select l.valor = t.valor and l.valor = 500.00
     from public.liquidacoes l join public.transacoes t on t.id = l.transacao_id
    where l.tipo='divida'), true);

-- ---------------------------------------------------------------------
-- 8 a 10 · liquidar de novo a mesma competência é recusado
-- ---------------------------------------------------------------------
select pg_temp.deve_falhar(8,'a mesma parcela não se liquida duas vezes', $cmd$
  select public.liquida_compromisso('divida','eeee0001-0000-4000-8000-000000000001','2026-09',
    'bbbb0001-0000-4000-8000-000000000001', 500.00, '2026-09-13', 'duplicata', null, '') $cmd$);

-- outra competência da MESMA dívida pode: é outra parcela
insert into ids
select 'tx_out', public.liquida_compromisso(
  'divida','eeee0001-0000-4000-8000-000000000001','2026-10',
  'bbbb0001-0000-4000-8000-000000000001', 500.00, '2026-10-12', 'Parcela de outubro', null, '')::text;
select pg_temp.confere(9,'a parcela do mês seguinte é outra obrigação e pode ser paga',
  (select count(*) from public.liquidacoes where tipo='divida'), 2::bigint);
select pg_temp.confere(10,'e cada uma tem sua própria transação',
  (select count(distinct transacao_id) from public.liquidacoes where tipo='divida'), 2::bigint);

-- ---------------------------------------------------------------------
-- 11 a 13 · conta fixa usa a mesma convenção da V1
-- ---------------------------------------------------------------------
insert into ids
select 'tx_fixa', public.liquida_compromisso(
  'fixa','fx:ffff0001-0000-4000-8000-000000000001','2026-09',
  'bbbb0001-0000-4000-8000-000000000001', 120.00, '2026-09-10', 'Conta fixa do mês', null, '')::text;
select pg_temp.confere(11,'conta fixa liquida com o prefixo fx:',
  (select count(*) from public.liquidacoes where tipo='fixa'
     and item_id='fx:ffff0001-0000-4000-8000-000000000001'), 1::bigint);
select pg_temp.confere(12,'e cria a marca da V1 com o MESMO item_id',
  (select count(*) from public.pagamentos
    where item_id='fx:ffff0001-0000-4000-8000-000000000001' and mes='2026-09'), 1::bigint);
select pg_temp.deve_falhar(13,'conta fixa sem o prefixo fx: é recusada', $cmd$
  select public.liquida_compromisso('fixa','ffff0001-0000-4000-8000-000000000001','2026-11',
    'bbbb0001-0000-4000-8000-000000000001', 120.00, '2026-11-10', 'sem prefixo', null, '') $cmd$);

-- ---------------------------------------------------------------------
-- 14 a 18 · CASO D · receita prevista de 1.000, recebida uma vez
-- ---------------------------------------------------------------------
insert into ids
select 'tx_receita', public.recebe_receita(
  'aaaa0001-0000-4000-8000-000000000001','2026-09',
  'bbbb0001-0000-4000-8000-000000000001', 1000.00, '2026-09-05', 'Receita recebida', null, '')::text;

select pg_temp.confere(14,'receber cria UMA entrada',
  (select count(*) from public.transacoes where tipo='entrada' and valor=1000.00), 1::bigint);
select pg_temp.confere(15,'entrada realizada é 1.000, não 2.000',
  (select sum(valor) from public.transacoes where tipo='entrada' and status='realizada'),
  1000.00::numeric);
-- a lacuna da V1: receita não tem marcador. O vínculo passou a ser o marcador.
select pg_temp.confere(16,'receita NÃO vira linha em pagamentos',
  (select count(*) from public.pagamentos
    where item_id='aaaa0001-0000-4000-8000-000000000001'), 0::bigint);
select pg_temp.confere(17,'mas o vínculo registra o recebimento',
  (select count(*) from public.liquidacoes where tipo='receita' and competencia='2026-09'), 1::bigint);
select pg_temp.deve_falhar(18,'a mesma receita não se recebe duas vezes no mês', $cmd$
  select public.recebe_receita('aaaa0001-0000-4000-8000-000000000001','2026-09',
    'bbbb0001-0000-4000-8000-000000000001', 1000.00, '2026-09-06', 'duplicata', null, '') $cmd$);

-- ---------------------------------------------------------------------
-- 19 a 22 · desfazer leva as três coisas
-- ---------------------------------------------------------------------
select public.desfaz_liquidacao('divida','eeee0001-0000-4000-8000-000000000001','2026-09');
select pg_temp.confere(19,'desfazer apaga a transação',
  (select count(*) from public.transacoes
    where id = (select valor from ids where chave='tx_divida')::uuid), 0::bigint);
select pg_temp.confere(20,'desfazer apaga o vínculo',
  (select count(*) from public.liquidacoes
    where tipo='divida' and competencia='2026-09'), 0::bigint);
select pg_temp.confere(21,'desfazer apaga a marca de pago da V1',
  (select count(*) from public.pagamentos
    where mes='2026-09' and item_id='eeee0001-0000-4000-8000-000000000001'), 0::bigint);
select pg_temp.deve_falhar(22,'desfazer o que não existe é recusado', $cmd$
  select public.desfaz_liquidacao('divida','eeee0001-0000-4000-8000-000000000001','2026-09') $cmd$);

-- ---------------------------------------------------------------------
-- 23 e 24 · apagar a transação direto também desfaz a ponte
-- ---------------------------------------------------------------------
delete from public.transacoes where id = (select valor from ids where chave='tx_fixa')::uuid;
select pg_temp.confere(23,'apagar a transação apaga o vínculo pelo cascade',
  (select count(*) from public.liquidacoes where tipo='fixa'), 0::bigint);
select pg_temp.confere(24,'e o gatilho apaga a marca da V1 junto',
  (select count(*) from public.pagamentos
    where item_id='fx:ffff0001-0000-4000-8000-000000000001'), 0::bigint);

-- ---------------------------------------------------------------------
-- 25 · a marca da V1 SEM ponte continua intocada
--   quem só clica no quadradinho não é afetado por nada disto
-- ---------------------------------------------------------------------
insert into public.pagamentos (mes, item_id) values ('2026-12','eeee0001-0000-4000-8000-000000000001');
delete from public.transacoes where id = (select valor from ids where chave='tx_out')::uuid;
select pg_temp.confere(25,'marca feita à mão sobrevive: a ponte é opcional',
  (select count(*) from public.pagamentos where mes='2026-12'), 1::bigint);

-- ---------------------------------------------------------------------
-- 26 a 29 · o que a ponte recusa
-- ---------------------------------------------------------------------
select pg_temp.deve_falhar(26,'compromisso de outro usuário é recusado', $cmd$
  select public.liquida_compromisso('divida','eeee0009-0000-4000-8000-000000000009','2026-09',
    'bbbb0001-0000-4000-8000-000000000001', 100.00, '2026-09-12', 'alheio', null, '') $cmd$);
select pg_temp.deve_falhar(27,'conta de outro usuário é recusada', $cmd$
  select public.liquida_compromisso('divida','eeee0001-0000-4000-8000-000000000001','2026-11',
    'bbbb0003-0000-4000-8000-000000000003', 500.00, '2026-11-12', 'conta alheia', null, '') $cmd$);
select pg_temp.deve_falhar(28,'valor zero é recusado', $cmd$
  select public.liquida_compromisso('divida','eeee0001-0000-4000-8000-000000000001','2026-11',
    'bbbb0001-0000-4000-8000-000000000001', 0, '2026-11-12', 'zero', null, '') $cmd$);
select pg_temp.deve_falhar(29,'competência fora do formato AAAA-MM é recusada', $cmd$
  select public.liquida_compromisso('divida','eeee0001-0000-4000-8000-000000000001','novembro',
    'bbbb0001-0000-4000-8000-000000000001', 500.00, '2026-11-12', 'formato', null, '') $cmd$);

-- ---------------------------------------------------------------------
-- 30 · nada acontece automaticamente
--   transação solta NÃO marca compromisso nenhum
-- ---------------------------------------------------------------------
insert into public.transacoes (conta_id, tipo, natureza, descricao, valor, data, status)
values ('bbbb0001-0000-4000-8000-000000000001','saida','normal','Saída solta',500.00,'2026-09-20','realizada');
select pg_temp.confere(30,'transação solta não cria vínculo nem marca',
  (select (select count(*) from public.liquidacoes)
        + (select count(*) from public.pagamentos where mes='2026-09')), 1::bigint);

-- ---------------------------------------------------------------------
-- 31 e 32 · o outro usuário e o anônimo
-- ---------------------------------------------------------------------
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222"}';
select pg_temp.confere(31,'o outro usuário não enxerga vínculo alheio',
  (select count(*) from public.liquidacoes), 0::bigint);

reset role;
set local role anon;
set local request.jwt.claims = '';
select pg_temp.deve_falhar(32,'anon não executa liquida_compromisso', $cmd$
  select public.liquida_compromisso('divida','eeee0001-0000-4000-8000-000000000001','2026-09',
    'bbbb0001-0000-4000-8000-000000000001', 500.00, '2026-09-12', 'x', null, '') $cmd$);
select pg_temp.deve_falhar(33,'anon não executa recebe_receita', $cmd$
  select public.recebe_receita('aaaa0001-0000-4000-8000-000000000001','2026-09',
    'bbbb0001-0000-4000-8000-000000000001', 1000.00, '2026-09-05', 'x', null, '') $cmd$);
select pg_temp.confere(34,'anon não enxerga liquidacoes',
  (select count(*) from public.liquidacoes), 0::bigint);

reset role;
select n, case when passou then 'ok' else 'FALHOU' end as situacao, caso, detalhe
  from resultado order by n;

rollback;
