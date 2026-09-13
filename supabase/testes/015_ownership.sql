-- =====================================================================
-- TESTES DE OWNERSHIP · contrato da 015
-- =====================================================================
-- Prova, no banco de verdade, o que a 015 promete: nenhuma linha consegue
-- apontar para objeto de outro dono, e apagar a conta no Auth não deixa meta
-- órfã.
--
-- COMO RODAR: cole o arquivo inteiro no SQL Editor, ou mande por
-- `execute_sql`. O último `select` é o placar. Qualquer `FALHOU` é defeito.
--
-- Roda inteiro dentro de uma transação e termina em `rollback`: não grava
-- nada. Os dois usuários são inventados aqui dentro (`1111…` e `2222…`) e
-- existem só durante a transação. Nenhum identificador real entra neste
-- arquivo, e todos os valores são redondos e inventados.
--
-- O QUE ESTE ARQUIVO PEGA QUE OS OUTROS NÃO PEGAM
--
-- Antes da 015, os casos 3 a 8 PASSAVAM no sentido errado: a inserção era
-- ACEITA, porque a FK conferia só `id` e a checagem de FK roda por fora do
-- RLS. Nenhuma suíte acusava, porque nenhuma tentava -- a tela nunca teria
-- como oferecer o credor de outra pessoa, e por isso ninguém escreveu o caso.
-- "Não dá para chegar lá pela tela" não é garantia do banco.
--
-- Uma armadilha que este arquivo contorna: a inserção precisa rodar como
-- `authenticated`, e não como `postgres`. Como dono das tabelas, `postgres`
-- passa por cima de RLS e de grant -- e um caso de "não pode" passaria
-- sozinho, provando nada.
-- =====================================================================

begin;

create temporary table resultado (
  n int, caso text, passou boolean, detalhe text
) on commit drop;

do $$
begin
  execute format('grant usage on schema %s to authenticated, anon',
                 pg_my_temp_schema()::regnamespace::text);
  execute format('grant select, insert on %s.resultado to authenticated, anon',
                 pg_my_temp_schema()::regnamespace::text);
end $$;

create function pg_temp.confere(n int, caso text, obtido anyelement, esperado anyelement)
returns void language plpgsql as $$
begin
  insert into resultado values (n, caso, obtido is not distinct from esperado,
    'obtido ' || coalesce(obtido::text, 'null') || ' · esperado ' || coalesce(esperado::text, 'null'));
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

create function pg_temp.deve_passar(n int, caso text, comando text)
returns void language plpgsql as $$
begin
  begin
    execute comando;
    insert into resultado values (n, caso, true, 'aceitou, como devia');
  exception when others then
    insert into resultado values (n, caso, false, 'RECUSOU: ' || left(sqlerrm, 70));
  end;
end $$;


-- ---------------------------------------------------------------------
-- cenário: duas pessoas, cada uma com credor, conta fixa e conta corrente
-- ---------------------------------------------------------------------
insert into auth.users (id) values
  ('11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222222');

insert into public.credores (id, user_id, nome) values
  ('eeee0001-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','Credor de A'),
  ('eeee0002-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111','Pessoa de A'),
  ('eeee0003-0000-4000-8000-000000000003','22222222-2222-4222-8222-222222222222','Credor de B');

insert into public.fixas (id, user_id, nome, valor) values
  ('77770001-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','Fixa de A', 200.00),
  ('77770002-0000-4000-8000-000000000002','22222222-2222-4222-8222-222222222222','Fixa de B', 300.00);

insert into public.contas (id, user_id, nome, saldo_inicial, saldo_inicial_em) values
  ('bbbb0001-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','Conta de A', 1000.00,'2026-01-01');


-- ---------------------------------------------------------------------
-- 1 a 8 · a FK composta: o que é de A aponta para o que é de A
-- ---------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111"}';

select pg_temp.deve_passar(1,'dívida de A referencia credor de A', $cmd$
  insert into public.dividas (id, credor, descricao, valor, mes_inicial, credor_id)
  values ('dddd0001-0000-4000-8000-000000000001','Credor de A','Dívida de A', 600.00,'2026-01',
          'eeee0001-0000-4000-8000-000000000001')
$cmd$);

select pg_temp.deve_passar(2,'dívida de A referencia pessoa de A', $cmd$
  update public.dividas set pessoa_id = 'eeee0002-0000-4000-8000-000000000002',
                            valor_terceiro = 100.00
   where id = 'dddd0001-0000-4000-8000-000000000001'
$cmd$);

-- Daqui até o 8, o id usado é de uma linha que A não consegue nem LER. A FK
-- não se importa com isso: ela olha o catálogo, não a policy. É exatamente
-- por isso que o par (user_id, id) é necessário.
select pg_temp.deve_falhar(3,'dívida de A NÃO referencia credor de B', $cmd$
  insert into public.dividas (credor, descricao, valor, mes_inicial, credor_id)
  values ('Credor de B','Dívida invasora', 100.00,'2026-01',
          'eeee0003-0000-4000-8000-000000000003')
$cmd$);

select pg_temp.deve_falhar(4,'dívida de A NÃO referencia pessoa de B', $cmd$
  insert into public.dividas (credor, descricao, valor, mes_inicial, pessoa_id, valor_terceiro)
  values ('Credor de A','Dívida invasora', 100.00,'2026-01',
          'eeee0003-0000-4000-8000-000000000003', 50.00)
$cmd$);

select pg_temp.deve_falhar(5,'conta fixa de A NÃO referencia credor de B', $cmd$
  update public.fixas set credor_id = 'eeee0003-0000-4000-8000-000000000003'
   where id = '77770001-0000-4000-8000-000000000001'
$cmd$);

select pg_temp.deve_falhar(6,'credor de A NÃO tem pai de B', $cmd$
  update public.credores set credor_pai_id = 'eeee0003-0000-4000-8000-000000000003'
   where id = 'eeee0001-0000-4000-8000-000000000001'
$cmd$);

select pg_temp.deve_falhar(7,'valor do mês de A NÃO pendura na fixa de B', $cmd$
  insert into public.fixas_mes (fixa_id, mes, valor)
  values ('77770002-0000-4000-8000-000000000002','2026-02', 310.00)
$cmd$);

-- O contrário, para o caso anterior não passar por acidente estrutural:
select pg_temp.deve_passar(8,'valor do mês de A pendura na fixa de A', $cmd$
  insert into public.fixas_mes (fixa_id, mes, valor)
  values ('77770001-0000-4000-8000-000000000001','2026-02', 210.00)
$cmd$);

-- E a hierarquia legítima dentro do mesmo dono continua permitida:
select pg_temp.deve_passar(9,'credor de A pode ter pai de A', $cmd$
  update public.credores set credor_pai_id = 'eeee0001-0000-4000-8000-000000000001'
   where id = 'eeee0002-0000-4000-8000-000000000002'
$cmd$);


-- ---------------------------------------------------------------------
-- 10 a 15 · exclusão: o comportamento de antes, preservado
-- ---------------------------------------------------------------------
-- A parte que mais poderia ter quebrado em silêncio. `on delete set null`
-- SEM a lista de colunas tentaria anular também o `user_id`, que é `not
-- null`, e a exclusão de credor simplesmente pararia de funcionar. Com a
-- lista, só a coluna de referência é anulada.

select pg_temp.deve_passar(10,'apagar credor de A ainda funciona', $cmd$
  delete from public.credores where id = 'eeee0001-0000-4000-8000-000000000001'
$cmd$);

select pg_temp.confere(11,'a dívida sobrevive ao credor',
  (select count(*) from public.dividas where id = 'dddd0001-0000-4000-8000-000000000001'), 1::bigint);
select pg_temp.confere(12,'e o credor dela virou nulo',
  (select credor_id from public.dividas where id = 'dddd0001-0000-4000-8000-000000000001'), null::uuid);
-- O CASO QUE IMPORTA: o dono NÃO foi anulado junto.
select pg_temp.confere(13,'e o DONO dela continua sendo A',
  (select user_id from public.dividas where id = 'dddd0001-0000-4000-8000-000000000001'),
  '11111111-1111-4111-8111-111111111111'::uuid);
-- O pai anulado pelo mesmo delete, pela FK que aponta credores para si mesma.
select pg_temp.confere(14,'o credor filho perdeu o pai e manteve o dono',
  (select credor_pai_id is null and user_id = '11111111-1111-4111-8111-111111111111'::uuid
     from public.credores where id = 'eeee0002-0000-4000-8000-000000000002'), true);

-- `fixas_mes` é cascade, e continua sendo: o valor de um mês não existe sem a
-- conta a que pertence.
select pg_temp.deve_passar(15,'apagar conta fixa de A ainda funciona', $cmd$
  delete from public.fixas where id = '77770001-0000-4000-8000-000000000001'
$cmd$);
select pg_temp.confere(16,'e o valor do mês foi junto, por cascade',
  (select count(*) from public.fixas_mes
    where fixa_id = '77770001-0000-4000-8000-000000000001'), 0::bigint);

reset role;


-- ---------------------------------------------------------------------
-- 17 a 20 · apagar a conta no Auth leva metas e alocações junto
-- ---------------------------------------------------------------------
-- Aqui não é teste de RLS, é teste de cascade, e por isso roda como dono das
-- tabelas: quem apaga linha de `auth.users` é a plataforma, não o app.

insert into public.metas (id, user_id, nome, valor_alvo) values
  ('55550001-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','Meta de A', 2000.00),
  ('55550002-0000-4000-8000-000000000002','22222222-2222-4222-8222-222222222222','Meta de B', 3000.00);

insert into public.alocacoes_de_meta (user_id, meta_id, valor, data) values
  ('11111111-1111-4111-8111-111111111111','55550001-0000-4000-8000-000000000001', 100.00,'2026-02-01'),
  ('22222222-2222-4222-8222-222222222222','55550002-0000-4000-8000-000000000002', 200.00,'2026-02-01');

select pg_temp.confere(17,'antes: duas metas e duas alocações',
  (select count(*) from public.metas)::text || '/' ||
  (select count(*) from public.alocacoes_de_meta)::text, '2/2');

select pg_temp.deve_passar(18,'apagar o usuário A em auth.users', $cmd$
  delete from auth.users where id = '11111111-1111-4111-8111-111111111111'
$cmd$);

select pg_temp.confere(19,'a meta de A foi junto, e a de B ficou',
  (select coalesce(string_agg(nome, ', ' order by nome), 'nenhuma') from public.metas), 'Meta de B');
select pg_temp.confere(20,'a alocação de A foi junto, e a de B ficou',
  (select count(*) from public.alocacoes_de_meta), 1::bigint);
-- Sem a FK da 015, estas duas linhas ficariam com um dono que não existe
-- mais: invisíveis para qualquer `auth.uid()` e impossíveis de alcançar.
select pg_temp.confere(21,'nenhuma meta com dono fora de auth.users',
  (select count(*) from public.metas m
    where not exists (select 1 from auth.users u where u.id = m.user_id)), 0::bigint);
select pg_temp.confere(22,'nenhuma alocação com dono fora de auth.users',
  (select count(*) from public.alocacoes_de_meta a
    where not exists (select 1 from auth.users u where u.id = a.user_id)), 0::bigint);


-- ---------------------------------------------------------------------
-- 23 a 26 · o RLS continua o que era
-- ---------------------------------------------------------------------
-- A 015 mexeu em integridade, não em visibilidade. Estes casos existem para
-- provar que ela não mexeu em visibilidade sem querer.
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222"}';

select pg_temp.confere(23,'B enxerga o credor dele',
  (select count(*) from public.credores), 1::bigint);
select pg_temp.confere(24,'B enxerga a meta dele, e só ela',
  (select coalesce(string_agg(nome, ', '), 'nenhuma') from public.metas), 'Meta de B');

reset role;
set local role anon;
set local request.jwt.claims = '';

select pg_temp.confere(25,'anon não enxerga credor nenhum',
  (select count(*) from public.credores), 0::bigint);
select pg_temp.confere(26,'anon não enxerga conta fixa, meta nem alocação',
  (select count(*) from public.fixas)
  + (select count(*) from public.metas)
  + (select count(*) from public.alocacoes_de_meta), 0::bigint);

reset role;


-- ---------------------------------------------------------------------
select n, case when passou then 'ok' else 'FALHOU' end as estado, caso, detalhe
  from resultado order by n;

select count(*) filter (where passou) as passaram,
       count(*) filter (where not passou) as falharam,
       coalesce(string_agg(caso, ' · ') filter (where not passou), '(nenhuma)') as falhas
  from resultado;

rollback;
