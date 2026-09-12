-- =====================================================================
-- TESTES DAS OPERAÇÕES DE TRANSFERÊNCIA · contrato da 004
-- =====================================================================
-- Roda inteiro dentro de uma transação e termina em `rollback`: não grava
-- nada, e as tabelas da V2 continuam vazias depois.
--
-- Diferença importante para o `002_integridade.sql`: lá quase tudo rodava como
-- `postgres`, que passa por cima do RLS. Aqui NÃO dá para fazer isso -- as
-- funções dependem de `auth.uid()`, e `postgres` não tem uma. Então o miolo
-- dos casos roda com `set local role authenticated` e um `request.jwt.claims`
-- montado à mão, que é exatamente o contexto do app real.
--
-- Os dois usuários são inventados aqui dentro. Nenhum identificador real entra
-- neste arquivo.
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

-- As duas ajudantes são SECURITY INVOKER, e isso NÃO é detalhe: com
-- `security definer` elas rodariam como `postgres`, que é dono das tabelas,
-- ignora RLS e tem todo grant. Um caso de "anon não pode" passaria sozinho,
-- provando nada. Foi o que aconteceu antes de este comentário existir. O preço
-- de ser invoker é precisar dar `insert` na tabela temporária aos papéis que
-- escrevem nela, logo acima.

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

-- ---------------------------------------------------------------------
-- cenário: duas pessoas, três contas
-- ---------------------------------------------------------------------
insert into auth.users (id) values
  ('11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222222');

insert into public.contas (id, user_id, nome, saldo_inicial, saldo_inicial_em) values
  ('bbbb0001-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Conta A', 1000.00, '2026-01-01'),
  ('bbbb0002-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'Conta B',  500.00, '2026-01-01'),
  ('bbbb0003-0000-4000-8000-000000000003', '22222222-2222-4222-8222-222222222222', 'Conta do Outro', 700.00, '2026-01-01');

-- daqui para baixo, é o usuário 1 logado no app
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111"}';

-- ---------------------------------------------------------------------
-- 1 a 6 · o caminho feliz
-- ---------------------------------------------------------------------
create temporary table grupo_teste (id uuid) on commit drop;
do $$
begin
  execute format('grant select, insert on %s.grupo_teste to authenticated',
                 pg_my_temp_schema()::regnamespace::text);
end $$;

insert into grupo_teste
select public.cria_transferencia(
  'bbbb0001-0000-4000-8000-000000000001',
  'bbbb0002-0000-4000-8000-000000000002',
  300.00, '2026-03-01', 'Transferência de teste', '', 'realizada');

set constraints all immediate;   -- o gatilho do par é diferido; força agora
set constraints all deferred;

select pg_temp.confere(1, 'a transferência nasceu com duas pernas',
  (select count(*) from public.transacoes where transferencia_id = (select id from grupo_teste)),
  2::bigint);

select pg_temp.confere(2, 'uma perna de saída e uma de entrada',
  (select string_agg(tipo, ',' order by tipo) from public.transacoes
    where transferencia_id = (select id from grupo_teste)),
  'entrada,saida'::text);

select pg_temp.confere(3, 'as duas pernas têm o mesmo valor',
  (select count(distinct valor) from public.transacoes
    where transferencia_id = (select id from grupo_teste)),
  1::bigint);

-- 1000 − 300
select pg_temp.confere(4, 'saldo da origem diminui',
  (select saldo from public.saldos_de_conta where conta_id = 'bbbb0001-0000-4000-8000-000000000001'),
  700.00::numeric);
-- 500 + 300
select pg_temp.confere(5, 'saldo do destino aumenta',
  (select saldo from public.saldos_de_conta where conta_id = 'bbbb0002-0000-4000-8000-000000000002'),
  800.00::numeric);
-- 1500 antes, 1500 depois: dinheiro mudou de gaveta
select pg_temp.confere(6, 'patrimônio consolidado não muda',
  (select sum(saldo) from public.saldos_de_conta), 1500.00::numeric);

-- ---------------------------------------------------------------------
-- 7 a 10 · o que a função recusa
-- ---------------------------------------------------------------------
select pg_temp.deve_falhar(7, 'mesma conta dos dois lados é recusada', $cmd$
  select public.cria_transferencia(
    'bbbb0001-0000-4000-8000-000000000001','bbbb0001-0000-4000-8000-000000000001',
    10.00, '2026-03-02')
$cmd$);

select pg_temp.deve_falhar(8, 'valor zero ou negativo é recusado', $cmd$
  select public.cria_transferencia(
    'bbbb0001-0000-4000-8000-000000000001','bbbb0002-0000-4000-8000-000000000002',
    0, '2026-03-02')
$cmd$);

select pg_temp.deve_falhar(9, 'conta de outro usuário é recusada', $cmd$
  select public.cria_transferencia(
    'bbbb0001-0000-4000-8000-000000000001','bbbb0003-0000-4000-8000-000000000003',
    10.00, '2026-03-02')
$cmd$);

select pg_temp.deve_falhar(10, 'conta inexistente é recusada', $cmd$
  select public.cria_transferencia(
    'bbbb0001-0000-4000-8000-000000000001','bbbb9999-0000-4000-8000-000000009999',
    10.00, '2026-03-02')
$cmd$);

-- ---------------------------------------------------------------------
-- 11 e 12 · atomicidade: falha no meio não deixa perna órfã
-- ---------------------------------------------------------------------
-- `status` inválido estoura no `check` da tabela, no meio do comando que
-- insere as duas pernas. Se a operação não fosse atômica, sobraria uma.
select pg_temp.deve_falhar(11, 'status inválido é recusado', $cmd$
  select public.cria_transferencia(
    'bbbb0001-0000-4000-8000-000000000001','bbbb0002-0000-4000-8000-000000000002',
    77.00, '2026-03-03', 'nao deve entrar', '', 'status_que_nao_existe')
$cmd$);

select pg_temp.confere(12, 'a tentativa falha não deixou perna órfã',
  (select count(*) from public.transacoes where valor = 77.00), 0::bigint);

-- ---------------------------------------------------------------------
-- 13 a 16 · edição mantém a integridade
-- ---------------------------------------------------------------------
select public.atualiza_transferencia(
  (select id from grupo_teste),
  'bbbb0002-0000-4000-8000-000000000002',   -- sentido invertido
  'bbbb0001-0000-4000-8000-000000000001',
  100.00, '2026-03-05', 'Transferência corrigida', '', 'realizada');
set constraints all immediate;
set constraints all deferred;

select pg_temp.confere(13, 'depois de editar continuam duas pernas',
  (select count(*) from public.transacoes where transferencia_id = (select id from grupo_teste)),
  2::bigint);
-- agora B manda 100 para A: 1000 + 100
select pg_temp.confere(14, 'edição inverte o sentido corretamente',
  (select saldo from public.saldos_de_conta where conta_id = 'bbbb0001-0000-4000-8000-000000000001'),
  1100.00::numeric);
select pg_temp.confere(15, 'a outra ponta acompanha',
  (select saldo from public.saldos_de_conta where conta_id = 'bbbb0002-0000-4000-8000-000000000002'),
  400.00::numeric);
select pg_temp.confere(16, 'patrimônio continua igual depois da edição',
  (select sum(saldo) from public.saldos_de_conta), 1500.00::numeric);

select pg_temp.deve_falhar(17, 'editar grupo inexistente é recusado', $cmd$
  select public.atualiza_transferencia(
    'dddd9999-0000-4000-8000-000000009999',
    'bbbb0001-0000-4000-8000-000000000001','bbbb0002-0000-4000-8000-000000000002',
    10.00, '2026-03-06')
$cmd$);

-- ---------------------------------------------------------------------
-- 18 a 20 · exclusão leva as duas pernas
-- ---------------------------------------------------------------------
select pg_temp.confere(18, 'excluir devolve duas linhas apagadas',
  public.remove_transferencia((select id from grupo_teste)), 2);

select pg_temp.confere(19, 'não sobrou nenhuma perna',
  (select count(*) from public.transacoes where transferencia_id = (select id from grupo_teste)),
  0::bigint);

select pg_temp.confere(20, 'saldos voltam ao ponto de partida',
  (select string_agg(saldo::text, ',' order by nome) from public.saldos_de_conta),
  '1000.00,500.00'::text);

select pg_temp.deve_falhar(21, 'excluir grupo inexistente é recusado', $cmd$
  select public.remove_transferencia('dddd9999-0000-4000-8000-000000009999')
$cmd$);

-- ---------------------------------------------------------------------
-- 22 · REGRESSÃO: o gatilho precisa rodar para um usuário de verdade
-- ---------------------------------------------------------------------
-- A 002 revogou `execute` de `confere_grupo_transferencia()`, que o gatilho
-- chamava com `perform`. Gatilho não precisa de `execute`; função CHAMADA por
-- ele precisa. Toda transferência de usuário real morria com "permission
-- denied", e o teste da 002 não pegou porque rodava como `postgres`, que é
-- dono e passa por cima.
--
-- Este caso insere as duas pernas DIRETO, sem RPC, como `authenticated`. Com
-- o gatilho da 002 de volta, ele falha.
insert into public.transacoes
  (conta_id, tipo, natureza, transferencia_id, descricao, valor, data, status)
values
  ('bbbb0001-0000-4000-8000-000000000001','saida','transferencia',
   'dddd0002-0000-4000-8000-000000000002','perna direta',25.00,'2026-03-09','realizada'),
  ('bbbb0002-0000-4000-8000-000000000002','entrada','transferencia',
   'dddd0002-0000-4000-8000-000000000002','perna direta',25.00,'2026-03-09','realizada');
set constraints all immediate;
set constraints all deferred;

select pg_temp.confere(22, 'gatilho do par roda para usuário autenticado',
  (select count(*) from public.transacoes
    where transferencia_id = 'dddd0002-0000-4000-8000-000000000002'), 2::bigint);

select public.remove_transferencia('dddd0002-0000-4000-8000-000000000002');

-- ---------------------------------------------------------------------
-- 23 · o outro usuário não alcança a transferência alheia
-- ---------------------------------------------------------------------
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222"}';

select pg_temp.deve_falhar(23, 'outro usuário não cria transferência em conta alheia', $cmd$
  select public.cria_transferencia(
    'bbbb0001-0000-4000-8000-000000000001','bbbb0002-0000-4000-8000-000000000002',
    10.00, '2026-03-07')
$cmd$);

-- ---------------------------------------------------------------------
-- 24 e 25 · anônimo não executa nada
-- ---------------------------------------------------------------------
reset role;
set local role anon;
/* limpa o claim: sem isto `auth.uid()` ainda devolveria o usuário anterior, e
   o caso passaria pela checagem de "está logado" antes de esbarrar no grant --
   provando a coisa errada */
set local request.jwt.claims = '';

select pg_temp.deve_falhar(24, 'anon não executa cria_transferencia', $cmd$
  select public.cria_transferencia(
    'bbbb0001-0000-4000-8000-000000000001','bbbb0002-0000-4000-8000-000000000002',
    10.00, '2026-03-08')
$cmd$);

select pg_temp.deve_falhar(25, 'anon não executa remove_transferencia', $cmd$
  select public.remove_transferencia('dddd0001-0000-4000-8000-000000000001')
$cmd$);

reset role;

select n, case when passou then 'ok' else 'FALHOU' end as situacao, caso, detalhe
  from resultado order by n;

rollback;
