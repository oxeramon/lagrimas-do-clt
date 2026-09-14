-- =====================================================================
-- TESTES DA REGRA DE ALOCAÇÃO · contrato da 016
-- =====================================================================
-- Prova, no banco de verdade, o que a 016 promete: a regra reserva uma vez por
-- competência, reserva só o que cabe, e não inventa dinheiro.
--
-- COMO RODAR: cole o arquivo inteiro no SQL Editor, ou mande por
-- `execute_sql`. O último `select` é o placar; qualquer `FALHOU` é defeito.
--
-- Roda dentro de uma transação e termina em `rollback`: não grava nada. Os
-- dois usuários são inventados aqui dentro e existem só durante a transação.
-- Nenhum identificador real entra neste arquivo, e todos os valores são
-- redondos e inventados.
--
-- A ARMADILHA DESTE ARQUIVO: o gatilho que confere a reserva contra o saldo
-- livre é DIFERIDO, então ele só dispararia no commit -- que nunca chega,
-- porque terminamos em rollback. `set constraints all immediate` força a
-- conferência na hora, e é assim que o caso 14 consegue existir.
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
    set constraints all immediate;
    insert into resultado values (n, caso, false, 'ACEITOU quando devia recusar');
  exception when others then
    insert into resultado values (n, caso, true, 'recusado: ' || left(sqlerrm, 70));
  end;
end $$;


-- ---------------------------------------------------------------------
-- cenário: A tem 1.000 livres e uma meta de 5.000 com regra de 300/mês
-- ---------------------------------------------------------------------
insert into auth.users (id) values
  ('11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222222');

insert into public.contas (id, user_id, nome, saldo_inicial, saldo_inicial_em, liquidez) values
  ('bbbb0001-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111',
   'Conta de A', 1000.00, '2026-01-01', 'livre'),
  -- dinheiro restrito NÃO entra na conta do que dá para reservar
  ('bbbb0002-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111',
   'Restrita de A', 9000.00, '2026-01-01', 'restrita');

-- `regra_desde` entrou na 017: regra ligada passou a exigir vigência, e sem
-- ela o check `regra_ativa_tem_desde` recusa a linha. A data é anterior a
-- todas as competências deste arquivo, para que a vigência cubra o que os
-- casos abaixo aplicam.
--
-- Este arquivo testa o que a 016 trouxe -- o índice único por competência e o
-- `least(regra, disponível, falta)` -- e continua testando. O que mudou foi o
-- CENÁRIO, que precisa ser válido no schema de hoje: migração é imutável,
-- suíte de teste não é, e uma suíte que não roda mais não prova nada.
insert into public.metas (id, user_id, nome, valor_alvo, regra_valor, regra_ativa, regra_desde) values
  ('55550001-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111',
   'Com regra', 5000.00, 300.00, true, '2026-01'),
  ('55550002-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111',
   'Sem regra', 2000.00, null, false, null),
  ('55550003-0000-4000-8000-000000000003','22222222-2222-4222-8222-222222222222',
   'De B', 1000.00, 100.00, true, '2026-01');


-- ---------------------------------------------------------------------
-- 1 a 4 · o modelo recusa estado sem sentido
-- ---------------------------------------------------------------------
select pg_temp.deve_falhar(1,'regra ligada sem valor é recusada', $cmd$
  update public.metas set regra_ativa = true, regra_valor = null
   where id = '55550002-0000-4000-8000-000000000002'
$cmd$);
select pg_temp.deve_falhar(2,'valor de regra zero ou negativo é recusado', $cmd$
  update public.metas set regra_valor = 0
   where id = '55550001-0000-4000-8000-000000000001'
$cmd$);
select pg_temp.deve_falhar(3,'alocação de regra sem competência é recusada', $cmd$
  insert into public.alocacoes_de_meta (user_id, meta_id, valor, data, origem, competencia)
  values ('11111111-1111-4111-8111-111111111111','55550001-0000-4000-8000-000000000001',
          10, '2026-09-01', 'regra', null)
$cmd$);
select pg_temp.deve_falhar(4,'competência fora do formato AAAA-MM é recusada', $cmd$
  insert into public.alocacoes_de_meta (user_id, meta_id, valor, data, origem, competencia)
  values ('11111111-1111-4111-8111-111111111111','55550001-0000-4000-8000-000000000001',
          10, '2026-09-01', 'regra', 'setembro')
$cmd$);


-- ---------------------------------------------------------------------
-- 5 a 9 · aplicar a regra, e aplicar de novo
-- ---------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111"}';

do $$
declare r record;
begin
  select * into r from public.aplica_regra_de_meta(
    '55550001-0000-4000-8000-000000000001', '2026-09');
  insert into resultado values (5,'a regra reserva os 300 do mês', r.alocado = 300.00,
    'alocado ' || r.alocado);
  insert into resultado values (6,'e ela não estava aplicada antes', r.ja_aplicada = false,
    'ja_aplicada ' || r.ja_aplicada);
  insert into resultado values (7,'o disponível era os 1.000 livres, sem os 9.000 restritos',
    r.disponivel = 1000.00, 'disponivel ' || r.disponivel);
end $$;

/* E · APLICAR DUAS VEZES NA MESMA COMPETÊNCIA DÁ UMA ALOCAÇÃO SÓ.
   O que garante isso é o índice único parcial, e não um `if` de tela: dois
   cliques rápidos são exatamente o que acontece quando a primeira resposta
   demora. */
do $$
declare r record;
begin
  select * into r from public.aplica_regra_de_meta(
    '55550001-0000-4000-8000-000000000001', '2026-09');
  insert into resultado values (8,'E · a segunda aplicação não aloca nada', r.alocado = 0,
    'alocado ' || r.alocado);
  insert into resultado values (9,'E · e ela se declara já aplicada', r.ja_aplicada = true,
    'ja_aplicada ' || r.ja_aplicada);
end $$;

select pg_temp.confere(10,'E · existe UMA alocação de regra para setembro, não duas',
  (select count(*) from public.alocacoes_de_meta
    where meta_id = '55550001-0000-4000-8000-000000000001'
      and competencia = '2026-09' and origem = 'regra'), 1::bigint);
select pg_temp.confere(11,'E · e o reservado da meta é 300, não 600',
  (select reservado from public.metas_resolvidas
    where meta_id = '55550001-0000-4000-8000-000000000001'), 300.00::numeric);

/* O índice é PARCIAL: reservar à mão duas vezes no mesmo mês continua sendo
   direito da pessoa, e não é a regra. */
insert into public.alocacoes_de_meta (meta_id, valor, data, obs)
values ('55550001-0000-4000-8000-000000000001', 50.00, '2026-09-10', 'à mão');
insert into public.alocacoes_de_meta (meta_id, valor, data, obs)
values ('55550001-0000-4000-8000-000000000001', 50.00, '2026-09-20', 'à mão de novo');
select pg_temp.confere(12,'alocação MANUAL pode repetir no mesmo mês',
  (select count(*) from public.alocacoes_de_meta
    where meta_id = '55550001-0000-4000-8000-000000000001' and origem = 'manual'), 2::bigint);
select pg_temp.confere(13,'e o reservado passa a ser 400',
  (select reservado from public.metas_resolvidas
    where meta_id = '55550001-0000-4000-8000-000000000001'), 400.00::numeric);

/* O gatilho da 014 continua de pé: ninguém reserva acima do saldo livre. É
   ele que torna impossível o "reservei 5.000 dos 1.000 que tenho". */
select pg_temp.deve_falhar(14,'reservar acima do saldo livre continua recusado', $cmd$
  insert into public.alocacoes_de_meta (meta_id, valor, data, obs)
  values ('55550001-0000-4000-8000-000000000001', 5000.00, '2026-09-25', 'demais')
$cmd$);


-- ---------------------------------------------------------------------
-- 15 a 18 · quando não cabe a regra inteira
-- ---------------------------------------------------------------------
-- Sobram 600 livres (1.000 − 400 já reservados) e a regra de junho pede 300:
-- essa cabe. Julho pede 300 de novo, com 300 sobrando: cabe rente. Agosto não
-- tem mais nada, e é aí que a regra encolhe.
--
-- OS MESES SÃO PASSADOS desde a 017, e não podem deixar de ser: reservar
-- competência FUTURA passou a ser recusado, porque é adiantar uma decisão que
-- ainda nem chegou. Este bloco usava junho, julho e agosto, e o
-- rebuild acusou -- que é exatamente o serviço que ele presta.
do $$
declare r record;
begin
  select * into r from public.aplica_regra_de_meta('55550001-0000-4000-8000-000000000001','2026-06');
  insert into resultado values (15,'junho ainda cabe inteiro', r.alocado = 300.00,
    'alocado ' || r.alocado);
  select * into r from public.aplica_regra_de_meta('55550001-0000-4000-8000-000000000001','2026-07');
  insert into resultado values (16,'julho cabe rente, e zera o disponível', r.alocado = 300.00,
    'alocado ' || r.alocado);
  select * into r from public.aplica_regra_de_meta('55550001-0000-4000-8000-000000000001','2026-08');
  insert into resultado values (17,'agosto não tem o que reservar, e NÃO cria linha',
    r.alocado = 0, 'alocado ' || r.alocado);
  insert into resultado values (18,'e o disponível está zerado', r.disponivel = 0,
    'disponivel ' || r.disponivel);
end $$;

select pg_temp.confere(19,'nenhuma alocação de zero foi criada: ruído não é histórico',
  (select count(*) from public.alocacoes_de_meta
    where meta_id = '55550001-0000-4000-8000-000000000001' and competencia = '2026-08'), 0::bigint);
select pg_temp.confere(20,'o reservado bateu no saldo livre e parou ali',
  (select reservado from public.metas_resolvidas
    where meta_id = '55550001-0000-4000-8000-000000000001'), 1000.00::numeric);
/* E O SALDO DA CONTA NÃO SE MEXEU. Reservar é envelope, não movimento. */
select pg_temp.confere(21,'reservar 1.000 não tirou um centavo da conta',
  (select saldo from public.saldos_de_conta
    where conta_id = 'bbbb0001-0000-4000-8000-000000000001'), 1000.00::numeric);


-- ---------------------------------------------------------------------
-- 22 a 24 · desfazer
-- ---------------------------------------------------------------------
select pg_temp.confere(22,'desfazer a regra de julho devolve verdadeiro',
  public.desfaz_regra_de_meta('55550001-0000-4000-8000-000000000001','2026-07'), true);
select pg_temp.confere(23,'e o reservado volta para 700',
  (select reservado from public.metas_resolvidas
    where meta_id = '55550001-0000-4000-8000-000000000001'), 700.00::numeric);
select pg_temp.confere(24,'desfazer o que não existe devolve falso, e não erro',
  public.desfaz_regra_de_meta('55550001-0000-4000-8000-000000000001','2025-01'), false);


-- ---------------------------------------------------------------------
-- 25 a 28 · o que a regra recusa
-- ---------------------------------------------------------------------
select pg_temp.deve_falhar(25,'meta sem regra ligada não aplica', $cmd$
  select public.aplica_regra_de_meta('55550002-0000-4000-8000-000000000002','2026-09')
$cmd$);
select pg_temp.deve_falhar(26,'competência fora do formato é recusada pela função', $cmd$
  select public.aplica_regra_de_meta('55550001-0000-4000-8000-000000000001','2026-13')
$cmd$);
/* A meta de B existe, e para A ela simplesmente não é encontrada: o RLS
   responde antes da função. A mensagem é a mesma de um id inventado. */
select pg_temp.deve_falhar(27,'meta de OUTRO usuário não é encontrada', $cmd$
  select public.aplica_regra_de_meta('55550003-0000-4000-8000-000000000003','2026-09')
$cmd$);
select pg_temp.confere(28,'e A não enxerga alocação nenhuma de B',
  (select count(*) from public.alocacoes_de_meta
    where meta_id = '55550003-0000-4000-8000-000000000003'), 0::bigint);

reset role;


-- ---------------------------------------------------------------------
-- 29 a 31 · anon
-- ---------------------------------------------------------------------
set local role anon;
set local request.jwt.claims = '';

select pg_temp.deve_falhar(29,'anon não executa aplica_regra_de_meta', $cmd$
  select public.aplica_regra_de_meta('55550001-0000-4000-8000-000000000001','2026-09')
$cmd$);
select pg_temp.deve_falhar(30,'anon não executa desfaz_regra_de_meta', $cmd$
  select public.desfaz_regra_de_meta('55550001-0000-4000-8000-000000000001','2026-09')
$cmd$);
select pg_temp.confere(31,'anon não enxerga alocação nenhuma',
  (select count(*) from public.alocacoes_de_meta), 0::bigint);

reset role;


-- ---------------------------------------------------------------------
select n, case when passou then 'ok' else 'FALHOU' end as estado, caso, detalhe
  from resultado order by n;

select count(*) filter (where passou) as passaram,
       count(*) filter (where not passou) as falharam,
       coalesce(string_agg(caso, ' · ') filter (where not passou), '(nenhuma)') as falhas
  from resultado;

rollback;
