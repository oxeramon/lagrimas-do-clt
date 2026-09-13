-- =====================================================================
-- TESTES DE PAGAMENTO PARCIAL DE FATURA · contrato da 012
-- =====================================================================
-- Roda inteiro dentro de uma transação e termina em `rollback`.
--
-- O miolo roda com `set local role authenticated` e um `request.jwt.claims`
-- montado à mão. Teste de autorização como `postgres` não prova nada.
--
-- AS TRÊS PERGUNTAS:
--
--   1. uma fatura aceita N pagamentos, e a soma fecha?
--   2. o consumo continua sendo a COMPRA, e não a soma dos pagamentos?
--   3. pagar acima do devido é recusado, e não acomodado?
--
-- O caso 6 merece atenção: ele existe porque a view ANTIGA juntava transações
-- e liquidações na mesma consulta e agrupava. Com uma liquidação funcionava;
-- com duas, cada item da fatura apareceria duas vezes e o `total` sairia
-- dobrado. O pagamento parcial teria transformado o total num número errado
-- sem ninguém tocar no cálculo do total.
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
    insert into resultado values (n, caso, true, 'recusado: ' || left(sqlerrm, 80));
  end;
end $$;

insert into auth.users (id) values
  ('11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222222');
insert into public.contas (id, user_id, nome, saldo_inicial, saldo_inicial_em) values
  ('bbbb0001-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','Conta Alfa',5000.00,'2026-01-01');
insert into public.cartoes (id, user_id, nome, dia_fechamento, dia_vencimento) values
  ('cccc0001-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','Cartao Exemplo',10,20);

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111"}';

-- ---------------------------------------------------------------------
-- 1 e 2 · a fatura nasce devendo
-- ---------------------------------------------------------------------
insert into ids select 'compra',
  public.registra_compra_de_cartao('cccc0001-0000-4000-8000-000000000001',
    'Compra Exemplo', 1000.00, current_date, 1, null, '')::text;
insert into ids select 'fatura', (select t.fatura_id::text from public.transacoes t
  where t.compra_id = (select valor from ids where chave='compra')::uuid limit 1);
update public.transacoes set status='realizada'
 where compra_id = (select valor from ids where chave='compra')::uuid;

select pg_temp.confere(1,'a fatura nasce devendo 1.000',
  (select total from public.faturas_resolvidas where fatura_id=(select valor from ids where chave='fatura')::uuid), 1000.00::numeric);
select pg_temp.confere(2,'e com zero pago',
  (select pago from public.faturas_resolvidas where fatura_id=(select valor from ids where chave='fatura')::uuid), 0.00::numeric);

-- ---------------------------------------------------------------------
-- 3 a 6 · PAGAMENTO PARCIAL: 400 de 1.000
-- ---------------------------------------------------------------------
insert into ids select 'p1', public.paga_fatura((select valor from ids where chave='fatura')::uuid,
  'bbbb0001-0000-4000-8000-000000000001', 400.00, current_date, '')::text;
select pg_temp.confere(3,'pago 400',
  (select pago from public.faturas_resolvidas where fatura_id=(select valor from ids where chave='fatura')::uuid), 400.00::numeric);
select pg_temp.confere(4,'restante 600',
  (select restante from public.faturas_resolvidas where fatura_id=(select valor from ids where chave='fatura')::uuid), 600.00::numeric);
select pg_temp.confere(5,'a situação é PARCIAL, não paga',
  (select situacao from public.faturas_resolvidas where fatura_id=(select valor from ids where chave='fatura')::uuid), 'parcial');
select pg_temp.confere(6,'o total NÃO foi multiplicado pelo join',
  (select total from public.faturas_resolvidas where fatura_id=(select valor from ids where chave='fatura')::uuid), 1000.00::numeric);

-- ---------------------------------------------------------------------
-- 7 a 11 · N pagamentos: 400 + 300 + 300 fecha
-- ---------------------------------------------------------------------
insert into ids select 'p2', public.paga_fatura((select valor from ids where chave='fatura')::uuid,
  'bbbb0001-0000-4000-8000-000000000001', 300.00, current_date, '')::text;
select pg_temp.confere(7,'o SEGUNDO pagamento é aceito -- era ele que a unique barrava',
  (select pago from public.faturas_resolvidas where fatura_id=(select valor from ids where chave='fatura')::uuid), 700.00::numeric);
select pg_temp.confere(8,'e o total continua 1.000 com dois pagamentos',
  (select total from public.faturas_resolvidas where fatura_id=(select valor from ids where chave='fatura')::uuid), 1000.00::numeric);

insert into ids select 'p3', public.paga_fatura((select valor from ids where chave='fatura')::uuid,
  'bbbb0001-0000-4000-8000-000000000001', 300.00, current_date, '')::text;
select pg_temp.confere(9,'400 + 300 + 300 fecha a fatura',
  (select situacao from public.faturas_resolvidas where fatura_id=(select valor from ids where chave='fatura')::uuid), 'paga');
select pg_temp.confere(10,'restante zero',
  (select restante from public.faturas_resolvidas where fatura_id=(select valor from ids where chave='fatura')::uuid), 0.00::numeric);
select pg_temp.confere(11,'três pagamentos registrados',
  (select pagamentos from public.faturas_resolvidas where fatura_id=(select valor from ids where chave='fatura')::uuid), 3::bigint);

-- ---------------------------------------------------------------------
-- 12 e 13 · O INVARIANTE: consumo e caixa não se somam
-- ---------------------------------------------------------------------
select pg_temp.confere(12,'consumo é 1.000: a compra, e não a soma dos pagamentos',
  public.total_devido_da_fatura((select valor from ids where chave='fatura')::uuid), 1000.00::numeric);
select pg_temp.confere(13,'saída de caixa acumulada é 1.000, nunca 2.000',
  (select coalesce(sum(valor),0) from public.transacoes
    where natureza='pagamento_de_fatura' and origem_id=(select valor from ids where chave='fatura')), 1000.00::numeric);

-- ---------------------------------------------------------------------
-- 14 · o excesso é BARRADO, não acomodado
-- ---------------------------------------------------------------------
select pg_temp.deve_falhar(14,'pagar mais do que falta é recusado', $cmd$
  select public.paga_fatura((select valor from ids where chave='fatura')::uuid,
    'bbbb0001-0000-4000-8000-000000000001', 10.00, current_date, '') $cmd$);

-- ---------------------------------------------------------------------
-- 15 a 19 · desfazer UM pagamento, e não todos
-- ---------------------------------------------------------------------
select pg_temp.confere(15,'desfazer um pagamento devolve true',
  public.desfaz_pagamento_de_fatura((select valor from ids where chave='p2')::uuid), true);
select pg_temp.confere(16,'e sobram dois: desfazer UM não apaga os outros',
  (select pagamentos from public.faturas_resolvidas where fatura_id=(select valor from ids where chave='fatura')::uuid), 2::bigint);
select pg_temp.confere(17,'o pago volta para 700',
  (select pago from public.faturas_resolvidas where fatura_id=(select valor from ids where chave='fatura')::uuid), 700.00::numeric);
select pg_temp.confere(18,'e a saída de caixa some junto: nada de pagamento órfão',
  (select coalesce(sum(valor),0) from public.transacoes
    where natureza='pagamento_de_fatura' and origem_id=(select valor from ids where chave='fatura')), 700.00::numeric);
select pg_temp.confere(19,'a fatura volta a ser parcial',
  (select situacao from public.faturas_resolvidas where fatura_id=(select valor from ids where chave='fatura')::uuid), 'parcial');

-- ---------------------------------------------------------------------
-- 20 · A PONTE NÃO REGREDIU: dívida continua com UMA liquidação
-- ---------------------------------------------------------------------
-- É a prova de que o índice parcial acertou o alvo: ele tirou a trava da
-- fatura sem tirar a que impede pagar a mesma dívida duas vezes (CASO B).
insert into public.dividas (id, user_id, credor, descricao, valor, total_parcelas, parcela_inicial, mes_inicial)
values ('eeee0001-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111',
        'Credor Exemplo','Item Exemplo',100.00,3,1,'2026-01');
insert into ids select 'liq1', public.liquida_compromisso('divida','eeee0001-0000-4000-8000-000000000001','2026-01',
  'bbbb0001-0000-4000-8000-000000000001', 100.00, current_date, 'Item Exemplo', null, '')::text;
select pg_temp.deve_falhar(20,'dívida continua aceitando UMA liquidação por competência', $cmd$
  select public.liquida_compromisso('divida','eeee0001-0000-4000-8000-000000000001','2026-01',
    'bbbb0001-0000-4000-8000-000000000001', 100.00, current_date, 'Item Exemplo', null, '') $cmd$);

-- ---------------------------------------------------------------------
-- 21 a 26 · o outro usuário e o anônimo
-- ---------------------------------------------------------------------
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222"}';
select pg_temp.confere(21,'o outro usuário não enxerga fatura alheia',
  (select count(*) from public.faturas_resolvidas), 0::bigint);
select pg_temp.deve_falhar(22,'nem desfaz pagamento alheio', $cmd$
  select public.desfaz_pagamento_de_fatura((select valor from ids where chave='p1')::uuid) $cmd$);
select pg_temp.deve_falhar(23,'nem paga fatura alheia', $cmd$
  select public.paga_fatura((select valor from ids where chave='fatura')::uuid,
    'bbbb0001-0000-4000-8000-000000000001', 10.00, current_date, '') $cmd$);

reset role;
set local role anon;
set local request.jwt.claims = '';
select pg_temp.confere(24,'anon não enxerga fatura nenhuma',
  (select count(*) from public.faturas_resolvidas), 0::bigint);
select pg_temp.deve_falhar(25,'anon não executa paga_fatura', $cmd$
  select public.paga_fatura(null, null, 1, current_date, '') $cmd$);
select pg_temp.deve_falhar(26,'anon não executa desfaz_pagamento_de_fatura', $cmd$
  select public.desfaz_pagamento_de_fatura(null) $cmd$);

-- ---------------------------------------------------------------------
-- 27 a 30 · OS GRANTS, que a 013 consertou
-- ---------------------------------------------------------------------
-- Estes quatro casos existem porque a 012 errou. `revoke ... from public` não
-- remove concessão EXPLÍCITA a um papel, e o Supabase concede execute a `anon`
-- por padrão em toda função nova. As três funções novas saíram com `anon=X`.
--
-- Rodam como `postgres` de propósito: são perguntas sobre o CATÁLOGO, não
-- sobre dado, e `has_function_privilege` responde a mesma coisa para qualquer
-- papel que pergunte.
reset role;
select pg_temp.confere(27,'anon não executa total_devido_da_fatura',
  has_function_privilege('anon','public.total_devido_da_fatura(uuid)','execute'), false);
select pg_temp.confere(28,'anon não executa total_pago_da_fatura',
  has_function_privilege('anon','public.total_pago_da_fatura(uuid)','execute'), false);
select pg_temp.confere(29,'a função de GATILHO saiu da API para todo mundo',
  has_function_privilege('authenticated','public.confere_pagamento_de_fatura()','execute'), false);
select pg_temp.confere(30,'e authenticated continua com as quatro de que precisa',
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname in ('total_devido_da_fatura','total_pago_da_fatura',
                        'paga_fatura','desfaz_pagamento_de_fatura')
      and has_function_privilege('authenticated', p.oid, 'execute')), 4::bigint);

select n, case when passou then 'ok' else 'FALHOU' end as situacao, caso, detalhe
  from resultado order by n;

rollback;
