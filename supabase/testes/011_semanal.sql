-- =====================================================================
-- TESTES DE ASSINATURA SEMANAL · contrato da 011
-- =====================================================================
-- Roda inteiro dentro de uma transação e termina em `rollback`.
--
-- O miolo roda com `set local role authenticated` e um `request.jwt.claims`
-- montado à mão. Teste de autorização como `postgres` não prova nada: ele
-- passa por cima de RLS e de grant.
--
-- A PERGUNTA CENTRAL: quatro ou cinco cobranças semanais cabem no mesmo mês?
-- Antes da 011 não cabiam -- a chave da ocorrência era o MÊS, e a segunda
-- colidia com a primeira. Por isso a 008 desviava e nem materializava semanal.
--
-- E a propriedade que torna seguro chamar a geração a cada carga da tela
-- continua sendo do BANCO, não de um `if`: materializar duas vezes não pode
-- criar ocorrência repetida.
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

insert into auth.users (id) values
  ('11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222222');

insert into public.contas (id, user_id, nome, saldo_inicial, saldo_inicial_em) values
  ('bbbb0001-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','Conta Alfa',1000.00,'2026-01-01');

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111"}';

-- ---------------------------------------------------------------------
-- 1 a 6 · a semanal finalmente materializa, e cabe mais de uma por mês
-- ---------------------------------------------------------------------
-- Início hoje, janela de 28 dias: exatamente cinco ocorrências
-- (hoje, +7, +14, +21, +28). Datas relativas, para o teste não envelhecer.
insert into public.assinaturas (id, nome, valor, frequencia, conta_id, inicio) values
  ('dddd0001-0000-4000-8000-000000000001','Semanal Exemplo', 10.00,'semanal',
   'bbbb0001-0000-4000-8000-000000000001', current_date);

insert into ids select 'criadas1',
  public.materializa_assinaturas((current_date + interval '28 days')::date)::text;

select pg_temp.confere(1,'a semanal agora materializa: antes da 011 não gerava nada',
  ((select valor from ids where chave='criadas1')::int > 0), true);
select pg_temp.confere(2,'cinco ocorrências em 28 dias: hoje, +7, +14, +21, +28',
  (select count(*) from public.transacoes
    where assinatura_id = 'dddd0001-0000-4000-8000-000000000001'), 5::bigint);
select pg_temp.confere(3,'as cinco têm datas distintas',
  (select count(distinct ocorrencia_em) from public.transacoes
    where assinatura_id = 'dddd0001-0000-4000-8000-000000000001'), 5::bigint);
select pg_temp.confere(4,'e ocorrencia_em acompanha a data do lançamento',
  (select count(*) from public.transacoes
    where assinatura_id is not null and ocorrencia_em is distinct from data), 0::bigint);
select pg_temp.confere(5,'todas nascem previstas: elas ainda não aconteceram',
  (select count(*) from public.transacoes
    where assinatura_id is not null and status <> 'prevista'), 0::bigint);
-- 28 dias sempre atravessam a virada de mês a partir de qualquer dia 4 ou
-- maior; para garantir a cobertura, o caso 6 pergunta pelo mês diretamente.
select pg_temp.confere(6,'a competência deixou de ser null para semanal',
  (select count(*) from public.transacoes
    where assinatura_id is not null and competencia is null), 0::bigint);

-- ---------------------------------------------------------------------
-- 7 a 10 · IDEMPOTÊNCIA: materializar duas vezes não duplica
-- ---------------------------------------------------------------------
insert into ids select 'criadas2',
  public.materializa_assinaturas((current_date + interval '28 days')::date)::text;
select pg_temp.confere(7,'a segunda geração não cria nada',
  (select valor from ids where chave='criadas2'), '0');
select pg_temp.confere(8,'e a contagem da semanal não se mexeu',
  (select count(*) from public.transacoes
    where assinatura_id='dddd0001-0000-4000-8000-000000000001'), 5::bigint);
select pg_temp.confere(9,'nenhuma data repetida por assinatura, em nenhuma',
  (select count(*) from (
     select assinatura_id, ocorrencia_em from public.transacoes
      where assinatura_id is not null
      group by assinatura_id, ocorrencia_em having count(*) > 1) d), 0::bigint);

-- Uma terceira volta, com janela MAIOR: tem de criar só o que faltava, e não
-- recriar o que já existe. É o caso que uma idempotência ingênua erra.
insert into ids select 'criadas3',
  public.materializa_assinaturas((current_date + interval '35 days')::date)::text;
select pg_temp.confere(10,'ampliar a janela cria só a ocorrência nova',
  (select valor from ids where chave='criadas3'), '1');

-- ---------------------------------------------------------------------
-- 11 a 14 · QUATRO ou CINCO no mesmo mês, que é o caso do enunciado
-- ---------------------------------------------------------------------
-- Uma assinatura que começa no dia 1 de um mês de 31 dias tem CINCO
-- ocorrências nele (1, 8, 15, 22, 29); começando no dia 5, tem QUATRO
-- (5, 12, 19, 26). As duas contas são feitas sobre datas fixas e passadas,
-- inseridas à mão, porque materializar só olha para a frente.
insert into public.assinaturas (id, nome, valor, frequencia, conta_id, inicio) values
  ('dddd0002-0000-4000-8000-000000000002','Cinco No Mes', 10.00,'semanal',
   'bbbb0001-0000-4000-8000-000000000001', date '2026-01-01');

insert into public.transacoes (assinatura_id, competencia, ocorrencia_em, conta_id,
  tipo, natureza, descricao, valor, data, status, origem)
select 'dddd0002-0000-4000-8000-000000000002', '2026-01', d,
       'bbbb0001-0000-4000-8000-000000000001',
       'saida','normal','Cinco No Mes',10.00, d, 'prevista','recorrencia'
  from unnest(array[date '2026-01-01', date '2026-01-08', date '2026-01-15',
                    date '2026-01-22', date '2026-01-29']) as d;

select pg_temp.confere(11,'CINCO cobranças semanais no mesmo mês são aceitas',
  (select count(*) from public.transacoes
    where assinatura_id='dddd0002-0000-4000-8000-000000000002' and competencia='2026-01'), 5::bigint);

insert into public.assinaturas (id, nome, valor, frequencia, conta_id, inicio) values
  ('dddd0003-0000-4000-8000-000000000003','Quatro No Mes', 10.00,'semanal',
   'bbbb0001-0000-4000-8000-000000000001', date '2026-02-05');

insert into public.transacoes (assinatura_id, competencia, ocorrencia_em, conta_id,
  tipo, natureza, descricao, valor, data, status, origem)
select 'dddd0003-0000-4000-8000-000000000003', '2026-02', d,
       'bbbb0001-0000-4000-8000-000000000001',
       'saida','normal','Quatro No Mes',10.00, d, 'prevista','recorrencia'
  from unnest(array[date '2026-02-05', date '2026-02-12', date '2026-02-19',
                    date '2026-02-26']) as d;

select pg_temp.confere(12,'QUATRO no mês também, e sem nenhuma acomodação especial',
  (select count(*) from public.transacoes
    where assinatura_id='dddd0003-0000-4000-8000-000000000003' and competencia='2026-02'), 4::bigint);

-- O que a 008 NÃO conseguia: duas linhas com a mesma competência.
select pg_temp.confere(13,'a competência repete de propósito -- ela agrupa, não identifica',
  (select count(distinct competencia) from public.transacoes
    where assinatura_id='dddd0002-0000-4000-8000-000000000002'), 1::bigint);

-- E o que continua barrado: a MESMA data duas vezes.
select pg_temp.deve_falhar(14,'a mesma data duas vezes é recusada pelo BANCO, não por um if', $cmd$
  insert into public.transacoes (assinatura_id, competencia, ocorrencia_em, conta_id,
    tipo, natureza, descricao, valor, data, status, origem)
  values ('dddd0002-0000-4000-8000-000000000002','2026-01', date '2026-01-08',
    'bbbb0001-0000-4000-8000-000000000001','saida','normal','Duplicata',10.00,
    date '2026-01-08','prevista','recorrencia') $cmd$);

-- ---------------------------------------------------------------------
-- 15 a 18 · virada de ano, fevereiro e ano bissexto
-- ---------------------------------------------------------------------
-- 2028 é bissexto. Estas são contas de calendário puro, feitas com `date`
-- (sem hora e sem fuso), então horário de verão não tem por onde entrar.
select pg_temp.confere(15,'sete dias sobre 29/12 caem no ano seguinte',
  (date '2026-12-29' + public.passo_da_frequencia('semanal'))::date, date '2027-01-05');
select pg_temp.confere(16,'fevereiro comum: 22/02 mais sete é 01/03',
  (date '2026-02-22' + public.passo_da_frequencia('semanal'))::date, date '2026-03-01');
select pg_temp.confere(17,'ano bissexto: 22/02/2028 mais sete é 29/02, que existe',
  (date '2028-02-22' + public.passo_da_frequencia('semanal'))::date, date '2028-02-29');
select pg_temp.confere(18,'e 29/02/2028 mais sete é 07/03',
  (date '2028-02-29' + public.passo_da_frequencia('semanal'))::date, date '2028-03-07');

-- ---------------------------------------------------------------------
-- 19 a 21 · a mensal não regrediu
-- ---------------------------------------------------------------------
insert into public.assinaturas (id, nome, valor, frequencia, conta_id, inicio) values
  ('dddd0004-0000-4000-8000-000000000004','Mensal Exemplo', 30.00,'mensal',
   'bbbb0001-0000-4000-8000-000000000001', current_date);
insert into ids select 'criadas4',
  public.materializa_assinaturas((current_date + interval '2 months')::date)::text;

select pg_temp.confere(19,'a mensal continua gerando',
  ((select count(*) from public.transacoes
     where assinatura_id='dddd0004-0000-4000-8000-000000000004') >= 2), true);
select pg_temp.confere(20,'e nunca duas no mesmo mês',
  (select count(*) from (
     select competencia from public.transacoes
      where assinatura_id='dddd0004-0000-4000-8000-000000000004'
      group by competencia having count(*) > 1) d), 0::bigint);
select pg_temp.confere(21,'toda ocorrência tem data: o CHECK novo cobra isso', $$t$$,
  case when (select count(*) from public.transacoes
              where assinatura_id is not null and ocorrencia_em is null) = 0
       then $$t$$ else $$f$$ end);

-- ---------------------------------------------------------------------
-- 22 a 23 · o CHECK e a coluna andam juntos
-- ---------------------------------------------------------------------
select pg_temp.deve_falhar(22,'ocorrência sem data é recusada', $cmd$
  insert into public.transacoes (assinatura_id, competencia, conta_id, tipo, natureza,
    descricao, valor, data, status, origem)
  values ('dddd0004-0000-4000-8000-000000000004','2030-01',
    'bbbb0001-0000-4000-8000-000000000001','saida','normal','Sem data',10.00,
    date '2030-01-05','prevista','recorrencia') $cmd$);

select pg_temp.deve_falhar(23,'data de ocorrência sem assinatura também é recusada', $cmd$
  insert into public.transacoes (ocorrencia_em, conta_id, tipo, natureza,
    descricao, valor, data, status, origem)
  values (date '2030-01-05','bbbb0001-0000-4000-8000-000000000001','saida','normal',
    'Solta',10.00, date '2030-01-05','realizada','manual') $cmd$);

-- ---------------------------------------------------------------------
-- 24 a 27 · o outro usuário e o anônimo
-- ---------------------------------------------------------------------
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222"}';
select pg_temp.confere(24,'o outro usuário não enxerga assinatura alheia',
  (select count(*) from public.assinaturas), 0::bigint);
select pg_temp.confere(25,'nem as ocorrências dela',
  (select count(*) from public.transacoes where assinatura_id is not null), 0::bigint);
select pg_temp.confere(26,'e gerar não cria nada para ele',
  public.materializa_assinaturas((current_date + interval '28 days')::date), 0);

reset role;
set local role anon;
set local request.jwt.claims = '';
select pg_temp.deve_falhar(27,'anon não executa materializa_assinaturas', $cmd$
  select public.materializa_assinaturas(null) $cmd$);

reset role;
select n, case when passou then 'ok' else 'FALHOU' end as situacao, caso, detalhe
  from resultado order by n;

rollback;
