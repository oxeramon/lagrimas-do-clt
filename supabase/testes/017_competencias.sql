-- =====================================================================
-- TESTES DAS COMPETÊNCIAS DA REGRA · contrato da 017
-- =====================================================================
-- Prova, no banco de verdade, o Modelo C: a competência atual roda sozinha,
-- as passadas nunca rodam sozinhas, e nada disso vira dinheiro inventado.
--
-- COMO RODAR: cole o arquivo inteiro no SQL Editor, ou mande por
-- `execute_sql`. O último `select` é o placar; qualquer `FALHOU` é defeito.
--
-- Roda dentro de uma transação e termina em `rollback`: não grava nada. Os
-- usuários são inventados aqui dentro. Nenhum identificador real entra neste
-- arquivo, e todos os valores são redondos e inventados.
--
-- A ARMADILHA, a mesma da 016: o gatilho que confere a reserva contra o saldo
-- livre é DIFERIDO e só dispararia no commit, que nunca chega. Onde um caso
-- depende dele, `set constraints all immediate` força a conferência na hora.
--
-- A SEGUNDA ARMADILHA, desta: "competência atual" é `current_date`, então o
-- arquivo não pode ter mês fixo escrito à mão -- ele apodreceria na virada do
-- mês. Toda competência aqui é calculada a partir de hoje.
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

-- As competências, sempre relativas a hoje: nada de mês escrito à mão.
create function pg_temp.mes(desloc int) returns text language sql immutable as $$
  select to_char((date_trunc('month', current_date) + (desloc || ' months')::interval)::date, 'YYYY-MM')
$$;


-- ---------------------------------------------------------------------
-- cenário: A tem 1.000 livres; duas metas com regra, vigência há 3 meses
-- ---------------------------------------------------------------------
insert into auth.users (id) values
  ('11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222222');

insert into public.contas (id, user_id, nome, saldo_inicial, saldo_inicial_em, liquidez) values
  ('bbbb0001-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111',
   'Conta de A', 1000.00, '2026-01-01', 'livre'),
  -- restrito NÃO entra no que dá para reservar
  ('bbbb0002-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111',
   'Restrita de A', 9000.00, '2026-01-01', 'restrita');

-- ALTA, prazo perto: tem que vir primeiro na disputa
insert into public.metas (id, user_id, nome, valor_alvo, prioridade, prazo,
                          regra_valor, regra_ativa, regra_desde) values
  ('55550001-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111',
   'Meta A', 9000.00, 1, current_date + 60, 500.00, true, pg_temp.mes(-3)),
  ('55550002-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111',
   'Meta B', 9000.00, 2, current_date + 90, 500.00, true, pg_temp.mes(-3)),
  -- regra criada HOJE: não pode gerar pendência de mês nenhum antes
  ('55550003-0000-4000-8000-000000000003','11111111-1111-4111-8111-111111111111',
   'Meta C', 9000.00, 3, null, 200.00, true, pg_temp.mes(0));

insert into public.metas (id, user_id, nome, valor_alvo, regra_valor, regra_ativa, regra_desde) values
  ('55550009-0000-4000-8000-000000000009','22222222-2222-4222-8222-222222222222',
   'Meta de outra pessoa', 9000.00, 500.00, true, pg_temp.mes(-3));

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111"}';


-- ---------------------------------------------------------------------
-- 1..4 · A COMPETÊNCIA ATUAL RODA SOZINHA, E SÓ ELA
-- ---------------------------------------------------------------------
-- 1.000 livres, três regras: 500 (alta) + 500 (média) + 200 (baixa).
-- Sequencial: A leva 500, B leva os 500 restantes, C não acha nada.
select count(*) from public.aplica_regras_da_competencia();

select pg_temp.confere(1,'a automação criou duas alocações, não três',
  (select count(*) from public.alocacoes_de_meta where origem='regra'), 2::bigint);
select pg_temp.confere(2,'prioridade alta levou a regra inteira',
  (select valor from public.alocacoes_de_meta
    where meta_id='55550001-0000-4000-8000-000000000001' and competencia=pg_temp.mes(0)), 500.00);
select pg_temp.confere(3,'a segunda levou só o que sobrou',
  (select valor from public.alocacoes_de_meta
    where meta_id='55550002-0000-4000-8000-000000000002' and competencia=pg_temp.mes(0)), 500.00);
-- disponível chegou a zero: a terceira não cria linha de valor nenhum
select pg_temp.confere(4,'sem disponível, a terceira NÃO cria alocação de zero',
  (select count(*) from public.alocacoes_de_meta
    where meta_id='55550003-0000-4000-8000-000000000003'), 0::bigint);

-- ---------------------------------------------------------------------
-- 5..6 · PASSADO NUNCA ENTRA NA AUTOMAÇÃO
-- ---------------------------------------------------------------------
select pg_temp.confere(5,'a automação não tocou em competência passada',
  (select count(*) from public.alocacoes_de_meta
    where origem='regra' and competencia <> pg_temp.mes(0)), 0::bigint);
select pg_temp.deve_falhar(6,'a automação recusa competência que não é a atual',
  format($cmd$ select * from public.aplica_regras_da_competencia(%L) $cmd$, pg_temp.mes(-1)));

-- ---------------------------------------------------------------------
-- 7..8 · IDEMPOTÊNCIA: rodar de novo não duplica
-- ---------------------------------------------------------------------
select count(*) from public.aplica_regras_da_competencia();
select pg_temp.confere(7,'rodar a automação de novo não cria linha nova',
  (select count(*) from public.alocacoes_de_meta where origem='regra'), 2::bigint);
select pg_temp.confere(8,'e a soma reservada não se mexe',
  (select sum(valor) from public.alocacoes_de_meta), 1000.00);

-- ---------------------------------------------------------------------
-- 9..11 · O VALOR PLANEJADO CONGELA A HISTÓRIA
-- ---------------------------------------------------------------------
select pg_temp.confere(9,'a alocação guarda quanto a regra pedia',
  (select valor_planejado from public.alocacoes_de_meta
    where meta_id='55550001-0000-4000-8000-000000000001' and competencia=pg_temp.mes(0)), 500.00);

update public.metas set regra_valor = 700.00
 where id='55550001-0000-4000-8000-000000000001';

select pg_temp.confere(10,'mudar a regra depois NÃO reescreve o planejado do passado',
  (select valor_planejado from public.alocacoes_de_meta
    where meta_id='55550001-0000-4000-8000-000000000001' and competencia=pg_temp.mes(0)), 500.00);
-- "faltou" continua DERIVADO, e do planejado congelado -- não da regra de hoje
select pg_temp.confere(11,'e "faltou" sai do congelado, dando zero e não 200',
  (select valor_planejado - valor from public.alocacoes_de_meta
    where meta_id='55550001-0000-4000-8000-000000000001' and competencia=pg_temp.mes(0)), 0.00);

update public.metas set regra_valor = 500.00
 where id='55550001-0000-4000-8000-000000000001';

-- ---------------------------------------------------------------------
-- 12..15 · APLICAR UMA PENDÊNCIA USA O DISPONÍVEL DE HOJE
-- ---------------------------------------------------------------------
-- Libera 300 dos 1.000 reservados, e regulariza o mês passado da Meta A.
insert into public.alocacoes_de_meta (meta_id, valor, data, obs) values
  ('55550002-0000-4000-8000-000000000002', -300.00, current_date, 'libera para o teste');

select pg_temp.confere(12,'sobraram 300 livres para prometer',
  public.saldo_livre_do_usuario() - public.total_reservado_em_metas(), 300.00);

select alocado from public.aplica_regra_de_meta(
  '55550001-0000-4000-8000-000000000001', pg_temp.mes(-1));

select pg_temp.confere(13,'a pendência de 500 reserva os 300 que existem HOJE',
  (select valor from public.alocacoes_de_meta
    where meta_id='55550001-0000-4000-8000-000000000001' and competencia=pg_temp.mes(-1)), 300.00);
select pg_temp.confere(14,'e o planejado dela é a regra, não o que coube',
  (select valor_planejado from public.alocacoes_de_meta
    where meta_id='55550001-0000-4000-8000-000000000001' and competencia=pg_temp.mes(-1)), 500.00);
-- COMPETÊNCIA NÃO É DATA DE APLICAÇÃO: a linha é do mês passado, criada hoje
select pg_temp.confere(15,'a aplicação é de hoje, a competência é do mês passado',
  (select criado_em::date = current_date and competencia = pg_temp.mes(-1)
     from public.alocacoes_de_meta
    where meta_id='55550001-0000-4000-8000-000000000001' and competencia=pg_temp.mes(-1)), true);

-- ---------------------------------------------------------------------
-- 16..18 · IGNORAR É DECISÃO, E PERSISTE
-- ---------------------------------------------------------------------
select public.ignora_competencia_de_regra(
  '55550001-0000-4000-8000-000000000001', pg_temp.mes(-2));

select pg_temp.confere(16,'ignorar grava a decisão',
  (select situacao from public.competencias_de_regra
    where meta_id='55550001-0000-4000-8000-000000000001' and competencia=pg_temp.mes(-2)), 'ignorada');
select pg_temp.confere(17,'ignorar NÃO cria alocação',
  (select count(*) from public.alocacoes_de_meta
    where meta_id='55550001-0000-4000-8000-000000000001' and competencia=pg_temp.mes(-2)), 0::bigint);
select pg_temp.confere(18,'e guarda quanto a regra pedia, para o histórico não mentir',
  (select valor_planejado from public.competencias_de_regra
    where meta_id='55550001-0000-4000-8000-000000000001' and competencia=pg_temp.mes(-2)), 500.00);

-- ---------------------------------------------------------------------
-- 19..21 · AS DUAS DECISÕES SE EXCLUEM
-- ---------------------------------------------------------------------
select pg_temp.deve_falhar(19,'não dá para aplicar uma competência já ignorada',
  format($cmd$ select public.aplica_regra_de_meta(
    '55550001-0000-4000-8000-000000000001', %L) $cmd$, pg_temp.mes(-2)));
select pg_temp.deve_falhar(20,'nem ignorar uma já aplicada',
  format($cmd$ select public.ignora_competencia_de_regra(
    '55550001-0000-4000-8000-000000000001', %L) $cmd$, pg_temp.mes(-1)));
select pg_temp.deve_falhar(21,'e uma decisão por competência, garantida pelo índice',
  format($cmd$ insert into public.competencias_de_regra
    (user_id, meta_id, competencia, situacao, valor_planejado) values
    ('11111111-1111-4111-8111-111111111111','55550001-0000-4000-8000-000000000001',
     %L,'ignorada',500.00) $cmd$, pg_temp.mes(-2)));

-- ---------------------------------------------------------------------
-- 22..24 · VIGÊNCIA: a regra não alcança o que veio antes dela
-- ---------------------------------------------------------------------
select pg_temp.deve_falhar(22,'regra criada hoje não aplica o mês passado',
  format($cmd$ select public.aplica_regra_de_meta(
    '55550003-0000-4000-8000-000000000003', %L) $cmd$, pg_temp.mes(-1)));
select pg_temp.deve_falhar(23,'nem se ignora um mês anterior à vigência',
  format($cmd$ select public.ignora_competencia_de_regra(
    '55550003-0000-4000-8000-000000000003', %L) $cmd$, pg_temp.mes(-1)));
select pg_temp.deve_falhar(24,'e competência FUTURA não se reserva',
  format($cmd$ select public.aplica_regra_de_meta(
    '55550001-0000-4000-8000-000000000001', %L) $cmd$, pg_temp.mes(1)));

-- ---------------------------------------------------------------------
-- 25..26 · REGRA DESLIGADA NÃO GERA NADA
-- ---------------------------------------------------------------------
update public.metas set regra_ativa = false
 where id='55550002-0000-4000-8000-000000000002';

select pg_temp.deve_falhar(25,'regra desligada não aplica competência nenhuma',
  format($cmd$ select public.aplica_regra_de_meta(
    '55550002-0000-4000-8000-000000000002', %L) $cmd$, pg_temp.mes(-1)));
select pg_temp.deve_falhar(26,'e o par ligado-sem-vigência é recusado pelo check',
  $cmd$ update public.metas set regra_desde = null
         where id='55550001-0000-4000-8000-000000000001' $cmd$);

-- ---------------------------------------------------------------------
-- 27..29 · REGULARIZAR VÁRIAS: sequencial, nunca regra × meses
-- ---------------------------------------------------------------------
-- Libera 400 e manda duas pendências da Meta A. Só a primeira cabe inteira.
insert into public.alocacoes_de_meta (meta_id, valor, data, obs) values
  ('55550002-0000-4000-8000-000000000002', -400.00, current_date, 'libera para o teste');

select count(*) from public.regulariza_competencias(
  jsonb_build_array(
    jsonb_build_object('meta_id','55550001-0000-4000-8000-000000000001','competencia', pg_temp.mes(-3))));

select pg_temp.confere(27,'a pendência mais antiga foi regularizada com o que havia',
  (select valor from public.alocacoes_de_meta
    where meta_id='55550001-0000-4000-8000-000000000001' and competencia=pg_temp.mes(-3)), 400.00);
select pg_temp.confere(28,'o total reservado nunca passou do saldo livre',
  (select public.total_reservado_em_metas() <= public.saldo_livre_do_usuario()), true);
select pg_temp.confere(29,'nenhuma alocação de regra ficou com valor zero',
  (select count(*) from public.alocacoes_de_meta where origem='regra' and valor = 0), 0::bigint);

-- ---------------------------------------------------------------------
-- 30..32 · META É ENVELOPE, e continua sendo
-- ---------------------------------------------------------------------
select pg_temp.confere(30,'nada disso criou transação',
  (select count(*) from public.transacoes), 0::bigint);
select pg_temp.confere(31,'e o saldo da conta não se mexeu',
  public.saldo_livre_do_usuario(), 1000.00);
select pg_temp.confere(32,'alocação manual continua sem valor planejado',
  (select count(*) from public.alocacoes_de_meta
    where origem='manual' and valor_planejado is not null), 0::bigint);

-- ---------------------------------------------------------------------
-- 40..42 · META JÁ CHEIA: há dinheiro, mas não há o que reservar
-- ---------------------------------------------------------------------
-- O caso que faltava, e que só apareceu no mutation testing: com disponível
-- MAIOR que zero e a meta já no alvo, `least(regra, disponível, falta)` dá
-- zero. Sem a guarda, o insert tentaria gravar uma alocação de valor zero --
-- que o check `alocacao_valor_check` da 014 recusaria, derrubando a aplicação
-- inteira com erro de constraint em vez de simplesmente não fazer nada.
insert into public.alocacoes_de_meta (meta_id, valor, data, obs) values
  ('55550002-0000-4000-8000-000000000002', -200.00, current_date, 'libera para o teste');

insert into public.metas (id, user_id, nome, valor_alvo, prioridade,
                          regra_valor, regra_ativa, regra_desde) values
  ('55550004-0000-4000-8000-000000000004','11111111-1111-4111-8111-111111111111',
   'Meta D', 100.00, 3, 500.00, true, pg_temp.mes(0));
insert into public.alocacoes_de_meta (meta_id, valor, data, obs) values
  ('55550004-0000-4000-8000-000000000004', 100.00, current_date, 'enche a meta');

select pg_temp.confere(40,'há disponível de sobra neste ponto',
  (public.saldo_livre_do_usuario() - public.total_reservado_em_metas()) > 0, true);
select pg_temp.confere(41,'a meta cheia não reserva nada, e não dá erro',
  (select alocado from public.aplica_regra_de_meta(
     '55550004-0000-4000-8000-000000000004', pg_temp.mes(0))), 0.00);
select pg_temp.confere(42,'e nenhuma alocação de regra nasceu para ela',
  (select count(*) from public.alocacoes_de_meta
    where meta_id='55550004-0000-4000-8000-000000000004' and origem='regra'), 0::bigint);

-- ---------------------------------------------------------------------
-- 43..44 · ALOCAÇÃO MANUAL NÃO OCUPA A COMPETÊNCIA
-- ---------------------------------------------------------------------
-- Segundo caso que só apareceu no mutation testing. O banco PERMITE uma
-- alocação manual com competência preenchida -- o check só exige competência
-- de quem vem da regra. Se a conferência de "já aplicada" olhasse só
-- (meta, competência) e esquecesse a ORIGEM, essa linha manual bloquearia a
-- regra daquele mês, e a pessoa perderia a reserva automática por ter
-- reservado à mão antes.
insert into public.alocacoes_de_meta (meta_id, valor, data, competencia, obs) values
  ('55550003-0000-4000-8000-000000000003', 10.00, current_date, pg_temp.mes(0),
   'manual, mas com competencia');

select pg_temp.confere(43,'a manual com competência não marca a regra como aplicada',
  (select ja_aplicada from public.aplica_regra_de_meta(
     '55550003-0000-4000-8000-000000000003', pg_temp.mes(0))), false);
select pg_temp.confere(44,'e a regra daquele mês roda assim mesmo',
  (select count(*) from public.alocacoes_de_meta
    where meta_id='55550003-0000-4000-8000-000000000003' and origem='regra'), 1::bigint);

-- ---------------------------------------------------------------------
-- 33..35 · OWNERSHIP: a meta de outra pessoa não existe daqui
-- ---------------------------------------------------------------------
select pg_temp.deve_falhar(33,'não dá para aplicar regra de meta alheia',
  format($cmd$ select public.aplica_regra_de_meta(
    '55550009-0000-4000-8000-000000000009', %L) $cmd$, pg_temp.mes(0)));
select pg_temp.deve_falhar(34,'nem ignorar competência de meta alheia',
  format($cmd$ select public.ignora_competencia_de_regra(
    '55550009-0000-4000-8000-000000000009', %L) $cmd$, pg_temp.mes(0)));
select pg_temp.confere(35,'e a decisão de outra pessoa não é visível',
  (select count(*) from public.competencias_de_regra
    where meta_id='55550009-0000-4000-8000-000000000009'), 0::bigint);

-- ---------------------------------------------------------------------
-- 36..39 · ANON NÃO EXECUTA NADA DISSO
-- ---------------------------------------------------------------------
set local role anon;
set local request.jwt.claims = '';

select pg_temp.deve_falhar(36,'anon não executa aplica_regras_da_competencia',
  $cmd$ select * from public.aplica_regras_da_competencia() $cmd$);
select pg_temp.deve_falhar(37,'anon não executa ignora_competencia_de_regra',
  $cmd$ select public.ignora_competencia_de_regra(
    '55550001-0000-4000-8000-000000000001','2026-01') $cmd$);
select pg_temp.deve_falhar(38,'anon não executa regulariza_competencias',
  $cmd$ select * from public.regulariza_competencias('[]'::jsonb) $cmd$);
-- Mais forte do que "não enxerga nada": anon nem alcança a tabela. Em
-- `alocacoes_de_meta` ele tem `select` e o RLS devolve zero linhas; aqui o
-- grant foi revogado, e a recusa vem antes do RLS.
select pg_temp.deve_falhar(39,'anon nem lê a tabela de decisões',
  $cmd$ select count(*) from public.competencias_de_regra $cmd$);

reset role;


-- ---------------------------------------------------------------------
select n, case when passou then 'ok' else 'FALHOU' end as estado, caso, detalhe
  from resultado order by n;

select count(*) filter (where passou) as passaram,
       count(*) filter (where not passou) as falharam,
       coalesce(string_agg(caso, ' · ') filter (where not passou), '(nenhuma)') as falhas
  from resultado;

rollback;
