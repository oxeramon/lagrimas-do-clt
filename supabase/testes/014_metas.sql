-- =====================================================================
-- TESTES DE METAS · contrato da 014
-- =====================================================================
-- Roda inteiro dentro de uma transação e termina em `rollback`.
--
-- O miolo roda com `set local role authenticated` e um `request.jwt.claims`
-- montado à mão. Teste de autorização como `postgres` não prova nada.
--
-- OS CASOS 7, 8 E 9 SÃO O CONTRATO INTEIRO. Se qualquer um deles quebrar, meta
-- deixou de ser envelope e virou dinheiro -- e o produto passou a somar o mesmo
-- real duas vezes. Todo o resto é detalhe perto disso.
--
-- ATENÇÃO À TÉCNICA DO `deve_falhar`: o gatilho que barra reserva acima do
-- saldo é DIFERIDO, e gatilho diferido só dispara no commit. Como o teste
-- termina em rollback, ele nunca rodaria. `set constraints all immediate`
-- dentro do bloco força a checagem.
--
-- Isto não é preciosismo: na primeira versão deste arquivo os casos 13 e 15
-- passavam VERDES sem provar nada, e eu quase apliquei a migração acreditando
-- neles.
-- =====================================================================

begin;

create temporary table resultado (n int, caso text, passou boolean, detalhe text) on commit drop;
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
    'obtido ' || coalesce(obtido::text,'null') || ' · esperado ' || coalesce(esperado::text,'null'));
end $$;

/* Para gatilho DIFERIDO, `deve_falhar` sozinho não basta -- ver o cabeçalho. */
create function pg_temp.deve_falhar(n int, caso text, comando text)
returns void language plpgsql as $$
begin
  begin
    execute comando;
    set constraints all immediate;
    insert into resultado values (n, caso, false, 'ACEITOU quando devia recusar');
  exception when others then
    insert into resultado values (n, caso, true, 'recusado: ' || left(sqlerrm, 80));
  end;
end $$;

insert into auth.users (id) values
  ('11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222222');
insert into public.contas (id, user_id, nome, saldo_inicial, saldo_inicial_em, liquidez) values
  ('bbbb0001-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','Conta Livre',10000.00,'2026-01-01','livre'),
  ('bbbb0002-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111','Conta Presa',5000.00,'2026-01-01','bloqueada');

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111"}';

-- ---------------------------------------------------------------------
-- 1 a 6 · o básico: reservar move o percentual, não o dinheiro
-- ---------------------------------------------------------------------
select pg_temp.confere(1,'o saldo livre ignora a conta bloqueada',
  public.saldo_livre_do_usuario(), 10000.00::numeric);

insert into public.metas (id, nome, valor_alvo, prioridade) values
  ('aaaa0001-0000-4000-8000-000000000001','Viagem', 5000.00, 1);
select pg_temp.confere(2,'meta nasce com zero reservado',
  (select reservado from public.metas_resolvidas where nome='Viagem'), 0.00::numeric);
select pg_temp.confere(3,'e faltando o alvo inteiro',
  (select falta from public.metas_resolvidas where nome='Viagem'), 5000.00::numeric);

insert into public.alocacoes_de_meta (meta_id, valor, data) values
  ('aaaa0001-0000-4000-8000-000000000001', 2000.00, current_date);
select pg_temp.confere(4,'reservou 2.000',
  (select reservado from public.metas_resolvidas where nome='Viagem'), 2000.00::numeric);
select pg_temp.confere(5,'faltam 3.000',
  (select falta from public.metas_resolvidas where nome='Viagem'), 3000.00::numeric);
select pg_temp.confere(6,'40 por cento',
  (select percentual from public.metas_resolvidas where nome='Viagem'), 40);

-- ---------------------------------------------------------------------
-- 7 a 10 · O CONTRATO. Estes quatro são a razão de tudo existir.
-- ---------------------------------------------------------------------
select pg_temp.confere(7,'O SALDO DA CONTA NÃO SE MEXEU',
  (select saldo from public.saldos_de_conta where conta_id='bbbb0001-0000-4000-8000-000000000001'), 10000.00::numeric);
select pg_temp.confere(8,'o saldo livre também não',
  public.saldo_livre_do_usuario(), 10000.00::numeric);
select pg_temp.confere(9,'alocar NÃO criou transação nenhuma',
  (select count(*) from public.transacoes), 0::bigint);
select pg_temp.confere(10,'disponível não reservado = livre menos reservado',
  public.saldo_livre_do_usuario() - public.total_reservado_em_metas(), 8000.00::numeric);

-- ---------------------------------------------------------------------
-- 11 e 12 · liberar é linha NEGATIVA, não exclusão
-- ---------------------------------------------------------------------
insert into public.alocacoes_de_meta (meta_id, valor, data, obs) values
  ('aaaa0001-0000-4000-8000-000000000001', -500.00, current_date, 'precisei do dinheiro');
select pg_temp.confere(11,'liberar 500 deixa 1.500 reservados',
  (select reservado from public.metas_resolvidas where nome='Viagem'), 1500.00::numeric);
select pg_temp.confere(12,'e o histórico guarda as DUAS linhas',
  (select alocacoes from public.metas_resolvidas where nome='Viagem'), 2::bigint);

-- ---------------------------------------------------------------------
-- 13 a 15 · não se reserva o que não existe
-- ---------------------------------------------------------------------
select pg_temp.deve_falhar(13,'reservar acima do saldo livre é recusado', $cmd$
  insert into public.alocacoes_de_meta (meta_id, valor, data)
  values ('aaaa0001-0000-4000-8000-000000000001', 20000.00, current_date) $cmd$);
select pg_temp.confere(14,'e nada entrou por causa da tentativa',
  (select reservado from public.metas_resolvidas where nome='Viagem'), 1500.00::numeric);

insert into public.metas (id, nome, valor_alvo) values
  ('aaaa0002-0000-4000-8000-000000000002','Reserva', 20000.00);
select pg_temp.deve_falhar(15,'a conta bloqueada NÃO serve de lastro para meta', $cmd$
  insert into public.alocacoes_de_meta (meta_id, valor, data)
  values ('aaaa0002-0000-4000-8000-000000000002', 12000.00, current_date) $cmd$);

-- ---------------------------------------------------------------------
-- 16 e 17 · prazo
-- ---------------------------------------------------------------------
insert into public.metas (id, nome, valor_alvo, prazo) values
  ('aaaa0003-0000-4000-8000-000000000003','Com Prazo', 1200.00, (current_date + interval '5 months')::date);
select pg_temp.confere(16,'sem prazo, meses é null e não zero',
  (select meses_ate_prazo from public.metas_resolvidas where nome='Viagem'), null::int);
select pg_temp.confere(17,'com prazo, os meses são contados',
  ((select meses_ate_prazo from public.metas_resolvidas where nome='Com Prazo') between 5 and 6), true);

-- ---------------------------------------------------------------------
-- 18 a 20 · valores impossíveis
-- ---------------------------------------------------------------------
select pg_temp.deve_falhar(18,'alvo zero é recusado', $cmd$
  insert into public.metas (nome, valor_alvo) values ('Zero', 0) $cmd$);
select pg_temp.deve_falhar(19,'alocação de zero é recusada: não reserva nem libera', $cmd$
  insert into public.alocacoes_de_meta (meta_id, valor)
  values ('aaaa0001-0000-4000-8000-000000000001', 0) $cmd$);
select pg_temp.deve_falhar(20,'prioridade fora de 1..3 é recusada', $cmd$
  insert into public.metas (nome, valor_alvo, prioridade) values ('Errada', 10, 7) $cmd$);

-- ---------------------------------------------------------------------
-- 21 a 23 · limites da view e cascade
-- ---------------------------------------------------------------------
insert into public.metas (id, nome, valor_alvo) values
  ('aaaa0004-0000-4000-8000-000000000004','Pequena', 100.00);
insert into public.alocacoes_de_meta (meta_id, valor) values
  ('aaaa0004-0000-4000-8000-000000000004', 300.00);
select pg_temp.confere(21,'percentual não passa de 100',
  (select percentual from public.metas_resolvidas where nome='Pequena'), 100);
select pg_temp.confere(22,'e falta nunca é negativo',
  (select falta from public.metas_resolvidas where nome='Pequena'), 0.00::numeric);

delete from public.metas where id='aaaa0004-0000-4000-8000-000000000004';
select pg_temp.confere(23,'apagar a meta leva as alocações junto',
  (select count(*) from public.alocacoes_de_meta
    where meta_id='aaaa0004-0000-4000-8000-000000000004'), 0::bigint);

-- ---------------------------------------------------------------------
-- 24 a 30 · o outro usuário e o anônimo
-- ---------------------------------------------------------------------
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222"}';
select pg_temp.confere(24,'o outro usuário não enxerga meta alheia',
  (select count(*) from public.metas), 0::bigint);
select pg_temp.confere(25,'nem pela view',
  (select count(*) from public.metas_resolvidas), 0::bigint);
select pg_temp.confere(26,'nem as alocações',
  (select count(*) from public.alocacoes_de_meta), 0::bigint);
select pg_temp.deve_falhar(27,'nem aloca em meta alheia', $cmd$
  insert into public.alocacoes_de_meta (meta_id, valor)
  values ('aaaa0001-0000-4000-8000-000000000001', 10) $cmd$);
select pg_temp.confere(28,'e o saldo livre dele é zero, não o do outro',
  public.saldo_livre_do_usuario(), 0.00::numeric);

reset role;
set local role anon;
set local request.jwt.claims = '';
select pg_temp.confere(29,'anon não enxerga meta nenhuma',
  (select count(*) from public.metas_resolvidas), 0::bigint);
select pg_temp.deve_falhar(30,'anon não executa saldo_livre_do_usuario', $cmd$
  select public.saldo_livre_do_usuario() $cmd$);

reset role;
select n, case when passou then 'ok' else 'FALHOU' end as situacao, caso, detalhe
  from resultado order by n;

rollback;
