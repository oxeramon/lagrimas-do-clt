-- =====================================================================
-- TESTES DE GRUPO, RATEIO E ACERTO · contrato da 009
-- =====================================================================
-- Roda inteiro dentro de uma transação e termina em `rollback`.
--
-- Duas propriedades importam mais que as outras:
--
--   1. a soma dos rateios é EXATAMENTE o valor da despesa, e quem cobra é o
--      banco, num gatilho postergado que nem a RPC consegue contornar;
--   2. grupo calcula OBRIGAÇÃO e transação calcula DINHEIRO. Registrar acerto
--      sem escolher conta NÃO cria movimentação nenhuma.
--
-- Os gatilhos postergados só disparam no commit, e este arquivo termina em
-- rollback. Por isso os casos que os testam usam `set constraints all
-- immediate` dentro de um savepoint -- é a mesma técnica dos testes da 004.
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

-- Versão que força a conferência POSTERGADA a acontecer agora. Sem o
-- `set constraints all immediate`, o gatilho só dispararia no commit -- que
-- este arquivo nunca faz.
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

insert into auth.users (id) values
  ('11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222222');

insert into public.contas (id, user_id, nome, saldo_inicial, saldo_inicial_em) values
  ('bbbb0001-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','Conta Alfa',1000.00,'2026-01-01');

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111"}';

-- ---------------------------------------------------------------------
-- cenário: um grupo com três pessoas, uma delas sendo eu
-- ---------------------------------------------------------------------
insert into public.grupos (id, nome) values
  ('9999aaaa-0000-4000-8000-000000000001','Grupo Exemplo');
insert into public.membros (id, grupo_id, nome, sou_eu) values
  ('7777aaaa-0000-4000-8000-000000000001','9999aaaa-0000-4000-8000-000000000001','Eu', true),
  ('7777aaaa-0000-4000-8000-000000000002','9999aaaa-0000-4000-8000-000000000001','Pessoa B', false),
  ('7777aaaa-0000-4000-8000-000000000003','9999aaaa-0000-4000-8000-000000000001','Pessoa C', false);

select pg_temp.confere(1,'o grupo tem três membros',
  (select count(*) from public.membros), 3::bigint);
select pg_temp.deve_falhar(2,'dois "sou eu" no mesmo grupo é recusado', $cmd$
  insert into public.membros (grupo_id, nome, sou_eu)
  values ('9999aaaa-0000-4000-8000-000000000001','Impostor', true) $cmd$);
-- minimização de dados: não existe coluna para e-mail, telefone ou documento
select pg_temp.confere(3,'membro guarda nome e apelido, e nada mais que identifique',
  (select count(*) from information_schema.columns
    where table_schema='public' and table_name='membros'
      and column_name in ('email','telefone','cpf','documento')), 0::bigint);

-- ---------------------------------------------------------------------
-- 4 a 9 · despesa dividida em três, com os centavos fechando
-- ---------------------------------------------------------------------
-- 100 em três não divide: 33,34 + 33,33 + 33,33. A soma é exatamente 100.
insert into ids select 'despesa', public.registra_despesa_do_grupo(
  '9999aaaa-0000-4000-8000-000000000001','Jantar Exemplo', 100.00, '2026-09-10',
  '7777aaaa-0000-4000-8000-000000000001',
  '[{"membro":"7777aaaa-0000-4000-8000-000000000001","valor":33.34},
    {"membro":"7777aaaa-0000-4000-8000-000000000002","valor":33.33},
    {"membro":"7777aaaa-0000-4000-8000-000000000003","valor":33.33}]'::jsonb,
  null, '')::text;

select pg_temp.confere(4,'a despesa foi criada',
  (select count(*) from public.despesas_do_grupo), 1::bigint);
select pg_temp.confere(5,'com três partes',
  (select count(*) from public.rateios), 3::bigint);
select pg_temp.confere(6,'e as partes somam exatamente o valor da despesa',
  (select sum(valor) from public.rateios), 100.00::numeric);

-- O CONTRATO DOS CENTAVOS, cobrado pelo banco e não pela aplicação
select pg_temp.deve_falhar(7,'rateio que não fecha a soma é recusado', $cmd$
  select public.registra_despesa_do_grupo(
    '9999aaaa-0000-4000-8000-000000000001','Não Fecha', 100.00, '2026-09-10',
    '7777aaaa-0000-4000-8000-000000000001',
    '[{"membro":"7777aaaa-0000-4000-8000-000000000001","valor":33.33},
      {"membro":"7777aaaa-0000-4000-8000-000000000002","valor":33.33},
      {"membro":"7777aaaa-0000-4000-8000-000000000003","valor":33.33}]'::jsonb) $cmd$);
select pg_temp.deve_falhar(8,'despesa sem partes é um número sem dono', $cmd$
  select public.registra_despesa_do_grupo(
    '9999aaaa-0000-4000-8000-000000000001','Sem Partes', 50.00, '2026-09-10',
    '7777aaaa-0000-4000-8000-000000000001', '[]'::jsonb) $cmd$);
select pg_temp.deve_falhar(9,'mexer no valor da despesa depois quebra a soma, e é recusado', $cmd$
  update public.despesas_do_grupo set valor = 200.00
   where id = (select valor from ids where chave='despesa')::uuid $cmd$);

-- ---------------------------------------------------------------------
-- 10 a 14 · o saldo de cada um, e a soma que fecha em zero
-- ---------------------------------------------------------------------
-- Eu paguei 100 e me cabiam 33,34: tenho 66,66 a receber.
select pg_temp.confere(10,'quem pagou tem a receber a diferença',
  (select saldo from public.saldos_do_grupo where nome='Eu'), 66.66::numeric);
select pg_temp.confere(11,'quem não pagou deve a parte dele',
  (select saldo from public.saldos_do_grupo where nome='Pessoa B'), -33.33::numeric);
-- É assim que se sabe que a conta fecha.
select pg_temp.confere(12,'a soma dos saldos do grupo é ZERO',
  (select sum(saldo) from public.saldos_do_grupo), 0.00::numeric);
select pg_temp.confere(13,'e a view separa o que pagou do que lhe coube',
  (select pagou::text || '/' || coube::text from public.saldos_do_grupo where nome='Eu'),
  '100.00/33.34');
select pg_temp.confere(14,'quem não pagou nada tem pagou zero, e zero não é null',
  (select pagou from public.saldos_do_grupo where nome='Pessoa C'), 0.00::numeric);

-- ---------------------------------------------------------------------
-- 15 a 19 · ACERTO SEM CONTA: obrigação quita, dinheiro não se move
-- ---------------------------------------------------------------------
insert into ids select 'acerto1', public.registra_acerto(
  '9999aaaa-0000-4000-8000-000000000001',
  '7777aaaa-0000-4000-8000-000000000002',
  '7777aaaa-0000-4000-8000-000000000001',
  33.33, '2026-09-12', null, 'em espécie')::text;

select pg_temp.confere(15,'o acerto foi registrado',
  (select count(*) from public.acertos), 1::bigint);
-- ISTO É O CONTRATO: sem conta escolhida, NADA de transação
select pg_temp.confere(16,'sem conta escolhida, nenhuma transação é criada',
  (select count(*) from public.transacoes), 0::bigint);
select pg_temp.confere(17,'e o saldo da conta não se mexe',
  (select saldo from public.saldos_de_conta where conta_id='bbbb0001-0000-4000-8000-000000000001'),
  1000.00::numeric);
select pg_temp.confere(18,'mas a obrigação foi quitada: quem pagou zerou',
  (select saldo from public.saldos_do_grupo where nome='Pessoa B'), 0.00::numeric);
select pg_temp.confere(19,'e a soma continua zero',
  (select sum(saldo) from public.saldos_do_grupo), 0.00::numeric);

-- ---------------------------------------------------------------------
-- 20 a 24 · ACERTO COM CONTA: aí sim o dinheiro entra
-- ---------------------------------------------------------------------
insert into ids select 'acerto2', public.registra_acerto(
  '9999aaaa-0000-4000-8000-000000000001',
  '7777aaaa-0000-4000-8000-000000000003',
  '7777aaaa-0000-4000-8000-000000000001',
  33.33, '2026-09-12', 'bbbb0001-0000-4000-8000-000000000001', '')::text;

select pg_temp.confere(20,'com conta escolhida, a transação é criada',
  (select count(*) from public.transacoes), 1::bigint);
select pg_temp.confere(21,'e ela é uma ENTRADA, porque o dinheiro veio para mim',
  (select tipo from public.transacoes), 'entrada');
select pg_temp.confere(22,'o saldo da conta subiu',
  (select saldo from public.saldos_de_conta where conta_id='bbbb0001-0000-4000-8000-000000000001'),
  1033.33::numeric);
select pg_temp.confere(23,'o acerto guarda o vínculo com a transação',
  (select count(*) from public.acertos where transacao_id is not null), 1::bigint);
select pg_temp.confere(24,'e agora todo mundo está quite',
  (select count(*) from public.saldos_do_grupo where saldo <> 0), 0::bigint);

-- ---------------------------------------------------------------------
-- 25 a 29 · o que o grupo recusa
-- ---------------------------------------------------------------------
select pg_temp.deve_falhar(25,'acerto de alguém consigo mesmo é recusado', $cmd$
  select public.registra_acerto('9999aaaa-0000-4000-8000-000000000001',
    '7777aaaa-0000-4000-8000-000000000002','7777aaaa-0000-4000-8000-000000000002',
    10.00, '2026-09-12') $cmd$);
select pg_temp.deve_falhar(26,'acerto com valor zero é recusado', $cmd$
  select public.registra_acerto('9999aaaa-0000-4000-8000-000000000001',
    '7777aaaa-0000-4000-8000-000000000002','7777aaaa-0000-4000-8000-000000000001',
    0, '2026-09-12') $cmd$);
-- acerto entre duas OUTRAS pessoas não entra na sua conta: você não participou
select pg_temp.deve_falhar(27,'acerto de que você não participa não entra na sua conta', $cmd$
  select public.registra_acerto('9999aaaa-0000-4000-8000-000000000001',
    '7777aaaa-0000-4000-8000-000000000002','7777aaaa-0000-4000-8000-000000000003',
    10.00, '2026-09-12', 'bbbb0001-0000-4000-8000-000000000001') $cmd$);
select pg_temp.deve_falhar(28,'quem pagou precisa ser membro do grupo', $cmd$
  select public.registra_despesa_do_grupo('9999aaaa-0000-4000-8000-000000000001',
    'Estranho', 10.00, '2026-09-10','7777aaaa-0000-4000-8000-000000000009',
    '[{"membro":"7777aaaa-0000-4000-8000-000000000001","valor":10.00}]'::jsonb) $cmd$);
select pg_temp.deve_falhar(29,'só membro do grupo entra na divisão', $cmd$
  select public.registra_despesa_do_grupo('9999aaaa-0000-4000-8000-000000000001',
    'Divisão Estranha', 10.00, '2026-09-10','7777aaaa-0000-4000-8000-000000000001',
    '[{"membro":"7777aaaa-0000-4000-8000-000000000009","valor":10.00}]'::jsonb) $cmd$);

-- ---------------------------------------------------------------------
-- 30 · apagar a despesa leva os rateios, e o gatilho não reclama
-- ---------------------------------------------------------------------
delete from public.despesas_do_grupo where id = (select valor from ids where chave='despesa')::uuid;
set constraints all immediate;
select pg_temp.confere(30,'apagar a despesa leva as partes pelo cascade',
  (select count(*) from public.rateios), 0::bigint);
set constraints all deferred;

-- ---------------------------------------------------------------------
-- 31 a 35 · o outro usuário e o anônimo
-- ---------------------------------------------------------------------
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222"}';
select pg_temp.confere(31,'o outro usuário não enxerga grupo alheio',
  (select count(*) from public.grupos), 0::bigint);
select pg_temp.confere(32,'nem membro alheio',
  (select count(*) from public.membros), 0::bigint);
select pg_temp.confere(33,'nem o saldo do grupo alheio',
  (select count(*) from public.saldos_do_grupo), 0::bigint);

reset role;
set local role anon;
set local request.jwt.claims = '';
select pg_temp.confere(34,'anon não enxerga grupo nenhum',
  (select count(*) from public.grupos), 0::bigint);
select pg_temp.deve_falhar(35,'anon não executa registra_despesa_do_grupo', $cmd$
  select public.registra_despesa_do_grupo('9999aaaa-0000-4000-8000-000000000001',
    'x', 10.00, '2026-09-10','7777aaaa-0000-4000-8000-000000000001', '[]'::jsonb) $cmd$);

reset role;
-- Agregado, e não uma linha por caso, por um motivo prático: rodando pelo MCP,
-- só o resultado do ÚLTIMO comando volta, e um `select` que devolve zero
-- linhas quando tudo passa é indistinguível de um que não rodou.
select count(*) filter (where passou) as passaram,
       count(*) filter (where not passou) as falharam,
       coalesce(string_agg(n::text || ' ' || caso || ' :: ' || detalhe, ' | ')
                filter (where not passou), '(nenhuma)') as falhas
  from resultado;

rollback;
