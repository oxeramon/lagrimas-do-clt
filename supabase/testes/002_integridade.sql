-- =====================================================================
-- TESTES DE MODELO DA V2 · contrato da 002
-- =====================================================================
-- Prova, no banco de verdade, o que a 002 promete. Roda inteiro dentro de uma
-- transação e termina em `rollback`: nada fica gravado, e as quatro tabelas
-- continuam vazias depois.
--
-- COMO RODAR: cole o arquivo inteiro no SQL Editor, ou mande por
-- `execute_sql`. O último `select` é o placar. Qualquer linha com
-- `passou = false` é defeito.
--
-- Os dois usuários são inventados aqui dentro (`1111…` e `2222…`) e existem só
-- durante a transação. Nenhum identificador real entra neste arquivo.
--
-- Uma armadilha que este arquivo contorna: o gatilho que confere a
-- transferência é DIFERIDO, então ele só dispararia no commit -- que nunca
-- chega, porque terminamos em rollback. `set constraints all immediate` força
-- a conferência na hora, e é assim que os casos de transferência incompleta
-- conseguem ser testados.
-- =====================================================================

begin;

create temporary table resultado (
  n        int,
  caso     text,
  passou   boolean,
  detalhe  text
) on commit drop;

-- Os casos 22 em diante rodam com `set local role`, e um papel que não é dono
-- da tabela temporária não escreveria nela. As duas ajudantes vão de
-- `security definer` por isso, e só por isso: o VALOR que elas recebem é
-- calculado antes da chamada, no papel de quem chamou, então o RLS dos casos
-- de leitura continua valendo de verdade.
-- `pg_temp` é apelido de sessão e não serve num `grant`: ele precisa do nome
-- real do esquema temporário, que muda a cada conexão.
do $$
begin
  execute format('grant usage on schema %s to authenticated, anon',
                 pg_my_temp_schema()::regnamespace::text);
end $$;

-- ---------------------------------------------------------------------
-- utilitários
-- ---------------------------------------------------------------------
create function pg_temp.confere(n int, caso text, obtido anyelement, esperado anyelement)
returns void language plpgsql security definer as $$
begin
  insert into resultado values (n, caso, obtido is not distinct from esperado,
    'obtido ' || coalesce(obtido::text, 'null') || ' · esperado ' || coalesce(esperado::text, 'null'));
end $$;

create function pg_temp.deve_falhar(n int, caso text, comando text)
returns void language plpgsql security definer as $$
begin
  begin
    execute comando;
    insert into resultado values (n, caso, false, 'ACEITOU quando devia recusar');
  exception when others then
    insert into resultado values (n, caso, true, 'recusado: ' || left(sqlerrm, 70));
  end;
end $$;

-- ---------------------------------------------------------------------
-- cenário: dois usuários, cada um com instituição, contas e categorias
-- ---------------------------------------------------------------------
insert into auth.users (id) values
  ('11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222222');

insert into public.instituicoes (id, user_id, nome) values
  ('aaaa0001-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Instituição Um'),
  ('aaaa0002-0000-4000-8000-000000000002', '22222222-2222-4222-8222-222222222222', 'Instituição Dois');

insert into public.contas (id, user_id, instituicao_id, nome, saldo_inicial, saldo_inicial_em) values
  ('bbbb0001-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111',
   'aaaa0001-0000-4000-8000-000000000001', 'Conta A', 1000.00, '2026-01-01'),
  ('bbbb0002-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111',
   'aaaa0001-0000-4000-8000-000000000001', 'Conta B',  500.00, '2026-01-01'),
  ('bbbb0003-0000-4000-8000-000000000003', '22222222-2222-4222-8222-222222222222',
   'aaaa0002-0000-4000-8000-000000000002', 'Conta do Outro', 700.00, '2026-01-01');

insert into public.categorias (id, user_id, nome, fluxo) values
  ('cccc0001-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Raiz Um', 'saida'),
  ('cccc0002-0000-4000-8000-000000000002', '22222222-2222-4222-8222-222222222222', 'Raiz Dois', 'saida');

-- ---------------------------------------------------------------------
-- 1 e 2 · entrada aumenta, saída reduz
-- ---------------------------------------------------------------------
insert into public.transacoes (user_id, conta_id, tipo, natureza, descricao, valor, data) values
  ('11111111-1111-4111-8111-111111111111', 'bbbb0001-0000-4000-8000-000000000001',
   'entrada', 'normal', 'entrada de teste', 200.00, '2026-02-01'),
  ('11111111-1111-4111-8111-111111111111', 'bbbb0001-0000-4000-8000-000000000001',
   'saida', 'normal', 'saída de teste', 50.00, '2026-02-02');

-- 1000 + 200 − 50
select pg_temp.confere(1, 'entrada aumenta e saída reduz o saldo',
  (select saldo from public.saldos_de_conta where conta_id = 'bbbb0001-0000-4000-8000-000000000001'),
  1150.00::numeric);

-- ---------------------------------------------------------------------
-- 3 e 4 · transferência move entre contas e não cria patrimônio
-- ---------------------------------------------------------------------
-- patrimônio antes da transferência: 1150 na Conta A mais 500 na Conta B
insert into public.transacoes (user_id, conta_id, tipo, natureza, transferencia_id, descricao, valor, data) values
  ('11111111-1111-4111-8111-111111111111', 'bbbb0001-0000-4000-8000-000000000001',
   'saida', 'transferencia', 'dddd0001-0000-4000-8000-000000000001', 'perna de saída', 300.00, '2026-03-01'),
  ('11111111-1111-4111-8111-111111111111', 'bbbb0002-0000-4000-8000-000000000002',
   'entrada', 'transferencia', 'dddd0001-0000-4000-8000-000000000001', 'perna de entrada', 300.00, '2026-03-01');

set constraints all immediate;   -- força a conferência do grupo agora
set constraints all deferred;

-- 1150 − 300
select pg_temp.confere(2, 'transferência reduz a conta de origem',
  (select saldo from public.saldos_de_conta where conta_id = 'bbbb0001-0000-4000-8000-000000000001'),
  850.00::numeric);
-- 500 + 300
select pg_temp.confere(3, 'transferência aumenta a conta de destino',
  (select saldo from public.saldos_de_conta where conta_id = 'bbbb0002-0000-4000-8000-000000000002'),
  800.00::numeric);
-- 850 + 800 = 1650, igual a 1150 + 500 de antes
select pg_temp.confere(4, 'transferência não altera o patrimônio consolidado',
  (select sum(saldo) from public.saldos_de_conta where user_id = '11111111-1111-4111-8111-111111111111'),
  1650.00::numeric);

-- ---------------------------------------------------------------------
-- 5 e 6 · estorno tem sinal contrário ao da original
-- ---------------------------------------------------------------------
-- estorno de SAÍDA é ENTRADA: devolve dinheiro, saldo sobe
insert into public.transacoes (user_id, conta_id, tipo, natureza, estorno_de_id, descricao, valor, data)
select '11111111-1111-4111-8111-111111111111', 'bbbb0001-0000-4000-8000-000000000001',
       'entrada', 'estorno', t.id, 'estorno da saída', 50.00, '2026-04-01'
  from public.transacoes t
 where t.conta_id = 'bbbb0001-0000-4000-8000-000000000001' and t.tipo = 'saida' and t.natureza = 'normal';

-- 850 + 50
select pg_temp.confere(5, 'estorno de saída aumenta o saldo',
  (select saldo from public.saldos_de_conta where conta_id = 'bbbb0001-0000-4000-8000-000000000001'),
  900.00::numeric);

-- estorno de ENTRADA é SAÍDA: o dinheiro não era seu, saldo desce
insert into public.transacoes (user_id, conta_id, tipo, natureza, estorno_de_id, descricao, valor, data)
select '11111111-1111-4111-8111-111111111111', 'bbbb0001-0000-4000-8000-000000000001',
       'saida', 'estorno', t.id, 'estorno da entrada', 200.00, '2026-04-02'
  from public.transacoes t
 where t.conta_id = 'bbbb0001-0000-4000-8000-000000000001' and t.tipo = 'entrada' and t.natureza = 'normal';

-- 900 − 200
select pg_temp.confere(6, 'estorno de entrada reduz o saldo',
  (select saldo from public.saldos_de_conta where conta_id = 'bbbb0001-0000-4000-8000-000000000001'),
  700.00::numeric);

-- ---------------------------------------------------------------------
-- 7 · prevista e cancelada ficam fora do saldo realizado
-- ---------------------------------------------------------------------
insert into public.transacoes (user_id, conta_id, tipo, natureza, descricao, valor, data, status) values
  ('11111111-1111-4111-8111-111111111111', 'bbbb0001-0000-4000-8000-000000000001',
   'entrada', 'normal', 'ainda vai cair', 9999.00, '2026-05-01', 'prevista'),
  ('11111111-1111-4111-8111-111111111111', 'bbbb0001-0000-4000-8000-000000000001',
   'entrada', 'normal', 'cancelada', 8888.00, '2026-05-02', 'cancelada');

select pg_temp.confere(7, 'prevista e cancelada não entram no saldo',
  (select saldo from public.saldos_de_conta where conta_id = 'bbbb0001-0000-4000-8000-000000000001'),
  700.00::numeric);

-- ---------------------------------------------------------------------
-- 8 a 11 · integridade entre donos: o banco recusa, não o RLS
-- ---------------------------------------------------------------------
select pg_temp.deve_falhar(8, 'transação não aponta para conta de outro usuário', $cmd$
  insert into public.transacoes (user_id, conta_id, tipo, natureza, descricao, valor, data)
  values ('11111111-1111-4111-8111-111111111111', 'bbbb0003-0000-4000-8000-000000000003',
          'saida', 'normal', 'conta alheia', 10.00, '2026-06-01')
$cmd$);

select pg_temp.deve_falhar(9, 'transação não aponta para categoria de outro usuário', $cmd$
  insert into public.transacoes (user_id, conta_id, categoria_id, tipo, natureza, descricao, valor, data)
  values ('11111111-1111-4111-8111-111111111111', 'bbbb0001-0000-4000-8000-000000000001',
          'cccc0002-0000-4000-8000-000000000002', 'saida', 'normal', 'categoria alheia', 10.00, '2026-06-01')
$cmd$);

select pg_temp.deve_falhar(10, 'categoria não tem pai de outro usuário', $cmd$
  insert into public.categorias (user_id, pai_id, nome)
  values ('11111111-1111-4111-8111-111111111111', 'cccc0002-0000-4000-8000-000000000002', 'Filha Intrusa')
$cmd$);

select pg_temp.deve_falhar(11, 'conta não aponta para instituição de outro usuário', $cmd$
  insert into public.contas (user_id, instituicao_id, nome)
  values ('11111111-1111-4111-8111-111111111111', 'aaaa0002-0000-4000-8000-000000000002', 'Conta Intrusa')
$cmd$);

select pg_temp.deve_falhar(12, 'estorno não aponta para transação de outro usuário', $cmd$
  insert into public.transacoes (user_id, conta_id, tipo, natureza, estorno_de_id, descricao, valor, data)
  select '22222222-2222-4222-8222-222222222222', 'bbbb0003-0000-4000-8000-000000000003',
         'saida', 'estorno', t.id, 'estorno alheio', 10.00, '2026-06-01'
    from public.transacoes t where t.user_id = '11111111-1111-4111-8111-111111111111' limit 1
$cmd$);

-- ---------------------------------------------------------------------
-- 13 a 16 · transferência mal formada não passa
-- ---------------------------------------------------------------------
select pg_temp.deve_falhar(13, 'transferência de uma perna só é recusada', $cmd$
  insert into public.transacoes (user_id, conta_id, tipo, natureza, transferencia_id, descricao, valor, data)
  values ('11111111-1111-4111-8111-111111111111', 'bbbb0001-0000-4000-8000-000000000001',
          'saida', 'transferencia', 'dddd0009-0000-4000-8000-000000000009', 'perna sozinha', 10.00, '2026-07-01');
  set constraints all immediate
$cmd$);
set constraints all deferred;

select pg_temp.deve_falhar(14, 'as duas pernas precisam ter o mesmo valor', $cmd$
  insert into public.transacoes (user_id, conta_id, tipo, natureza, transferencia_id, descricao, valor, data) values
    ('11111111-1111-4111-8111-111111111111', 'bbbb0001-0000-4000-8000-000000000001',
     'saida', 'transferencia', 'dddd0008-0000-4000-8000-000000000008', 'perna a', 10.00, '2026-07-01'),
    ('11111111-1111-4111-8111-111111111111', 'bbbb0002-0000-4000-8000-000000000002',
     'entrada', 'transferencia', 'dddd0008-0000-4000-8000-000000000008', 'perna b', 20.00, '2026-07-01');
  set constraints all immediate
$cmd$);
set constraints all deferred;

select pg_temp.deve_falhar(15, 'transferência não vai e volta na mesma conta', $cmd$
  insert into public.transacoes (user_id, conta_id, tipo, natureza, transferencia_id, descricao, valor, data) values
    ('11111111-1111-4111-8111-111111111111', 'bbbb0001-0000-4000-8000-000000000001',
     'saida', 'transferencia', 'dddd0007-0000-4000-8000-000000000007', 'perna a', 10.00, '2026-07-01'),
    ('11111111-1111-4111-8111-111111111111', 'bbbb0001-0000-4000-8000-000000000001',
     'entrada', 'transferencia', 'dddd0007-0000-4000-8000-000000000007', 'perna b', 10.00, '2026-07-01');
  set constraints all immediate
$cmd$);
set constraints all deferred;

select pg_temp.deve_falhar(16, 'natureza transferencia exige grupo', $cmd$
  insert into public.transacoes (user_id, conta_id, tipo, natureza, descricao, valor, data)
  values ('11111111-1111-4111-8111-111111111111', 'bbbb0001-0000-4000-8000-000000000001',
          'saida', 'transferencia', 'sem grupo', 10.00, '2026-07-01')
$cmd$);

select pg_temp.deve_falhar(17, 'tipo transferencia deixou de existir', $cmd$
  insert into public.transacoes (user_id, conta_id, tipo, natureza, descricao, valor, data)
  values ('11111111-1111-4111-8111-111111111111', 'bbbb0001-0000-4000-8000-000000000001',
          'transferencia', 'normal', 'tipo antigo', 10.00, '2026-07-01')
$cmd$);

-- ---------------------------------------------------------------------
-- 18 a 20 · categorias: NULL, contrato de raiz e teto de três níveis
-- ---------------------------------------------------------------------
select pg_temp.deve_falhar(18, 'duas categorias-raiz com o mesmo nome são recusadas', $cmd$
  insert into public.categorias (user_id, nome) values
    ('11111111-1111-4111-8111-111111111111', 'Raiz Um')
$cmd$);

insert into public.categorias (id, user_id, pai_id, nome) values
  ('cccc0011-0000-4000-8000-000000000011', '11111111-1111-4111-8111-111111111111',
   'cccc0001-0000-4000-8000-000000000001', 'Filha'),
  ('cccc0012-0000-4000-8000-000000000012', '11111111-1111-4111-8111-111111111111',
   'cccc0011-0000-4000-8000-000000000011', 'Neta');

select pg_temp.confere(19, 'nível sai 1, 2 e 3 descendo a árvore',
  (select string_agg(nivel::text, ',' order by nivel) from public.categorias
    where user_id = '11111111-1111-4111-8111-111111111111'),
  '1,2,3'::text);

select pg_temp.deve_falhar(20, 'quarto nível é recusado', $cmd$
  insert into public.categorias (user_id, pai_id, nome)
  values ('11111111-1111-4111-8111-111111111111', 'cccc0012-0000-4000-8000-000000000012', 'Bisneta')
$cmd$);

-- Mesmo nome sob pais diferentes continua valendo. O pai aqui é a `Filha` de
-- nível 2, então a nova entra em nível 3 -- pendurá-la na `Neta` daria nível 4
-- e esbarraria no teto, que é outro teste.
insert into public.categorias (user_id, pai_id, nome) values
  ('11111111-1111-4111-8111-111111111111', 'cccc0011-0000-4000-8000-000000000011', 'Filha');
select pg_temp.confere(21, 'mesmo nome sob pais diferentes é permitido',
  (select count(*) from public.categorias
    where user_id = '11111111-1111-4111-8111-111111111111' and nome = 'Filha'),
  2::bigint);

-- ---------------------------------------------------------------------
-- 22 e 23 · como o usuário logado: ordem dos gatilhos e RLS
-- ---------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111"}';

-- sem mandar user_id: quem preenche é o gatilho. Se o gatilho de nível rodar
-- antes do de user_id, o nível sai 1 em vez de 2 -- era o defeito da 001.
insert into public.categorias (pai_id, nome)
values ('cccc0001-0000-4000-8000-000000000001', 'Filha Sem Dono Explícito');

select pg_temp.confere(22, 'nível correto quando o user_id vem do gatilho',
  (select nivel from public.categorias where nome = 'Filha Sem Dono Explícito'),
  2::smallint);

select pg_temp.confere(23, 'usuário logado enxerga apenas as próprias contas',
  (select count(*) from public.contas), 2::bigint);

select pg_temp.confere(24, 'usuário logado não enxerga transação alheia',
  (select count(*) from public.transacoes where user_id <> '11111111-1111-4111-8111-111111111111'),
  0::bigint);

-- insert e update continuam funcionando depois do revoke de execute
insert into public.instituicoes (nome) values ('Criada Pelo Gatilho');
select pg_temp.confere(25, 'insert continua funcionando sem execute nas funções de gatilho',
  (select user_id from public.instituicoes where nome = 'Criada Pelo Gatilho'),
  '11111111-1111-4111-8111-111111111111'::uuid);

reset role;

-- ---------------------------------------------------------------------
-- 26 e 27 · anônimo não vê nada
-- ---------------------------------------------------------------------
set local role anon;

select pg_temp.confere(26, 'anon não enxerga nada da V2',
  (select (select count(*) from public.contas) + (select count(*) from public.transacoes)
        + (select count(*) from public.categorias) + (select count(*) from public.instituicoes)),
  0::bigint);

select pg_temp.confere(27, 'anon não enxerga nada da V1 com dono',
  (select (select count(*) from public.dividas) + (select count(*) from public.credores)),
  0::bigint);

reset role;

-- ---------------------------------------------------------------------
-- placar
-- ---------------------------------------------------------------------
select n, caso, case when passou then 'ok' else 'FALHOU' end as situacao, detalhe
  from resultado order by n;

select count(*) filter (where passou) as passaram,
       count(*) filter (where not passou) as falharam,
       count(*) as total
  from resultado;

rollback;
