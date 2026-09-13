-- =====================================================================
-- ISOLAMENTO · o contrato de RLS do banco inteiro, varrido, não amostrado
-- =====================================================================
-- As outras suítes provam o isolamento nas tabelas de que cada migração trata.
-- Esta varre TODAS: percorre o catálogo e pergunta de cada tabela, de cada
-- view e de cada função se ela vaza. É a diferença entre "as que eu lembrei de
-- testar estão certas" e "nenhuma está errada".
--
-- Por isso ela não envelhece: tabela nova entra na varredura sozinha, e se
-- nascer sem policy é aqui que aparece.
--
-- COMO RODAR: cole o arquivo inteiro no SQL Editor, ou mande por `execute_sql`.
-- Roda dentro de uma transação e termina em `rollback`: nada fica gravado.
--
-- Os dois usuários são inventados aqui dentro (`1111…` e `2222…`) e existem só
-- durante a transação. Nenhum identificador real entra neste arquivo, e todos
-- os valores são redondos e inventados.
--
-- O que ela NÃO prova: que o Postgres implementa RLS corretamente. Prova que
-- este schema o usa em todo lugar em que precisa.
-- =====================================================================

begin;

create temporary table resultado (
  n int, caso text, passou boolean, detalhe text
) on commit drop;

-- Os casos com `set local role` rodam sob papel que não é dono da tabela
-- temporária, e sem este grant eles não conseguiriam escrever o resultado.
-- `pg_temp` é apelido de sessão e não serve num grant: precisa do nome real.
do $$
begin
  execute format('grant usage on schema %s to authenticated, anon',
                 pg_my_temp_schema()::regnamespace::text);
  execute format('grant select, insert on %s.resultado to authenticated, anon',
                 pg_my_temp_schema()::regnamespace::text);
end $$;

-- SECURITY INVOKER, como nas outras suítes: com `security definer` as ajudantes
-- rodariam como `postgres`, que é dono das tabelas e ignora RLS -- e todo caso
-- de "o outro não vê" passaria sozinho, provando nada.
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

-- As duas varreduras. Devolvem a lista do que vazou, e não um número: quando
-- falham, a mensagem já diz QUAL tabela está aberta -- que é a única coisa que
-- interessa saber às três da manhã.
create function pg_temp.tabelas_com_linha(fora text[] default array[]::text[])
returns text language plpgsql as $$
declare r record; n bigint; ruins text := '';
begin
  for r in select c.relname from pg_class c join pg_namespace s on s.oid = c.relnamespace
            where s.nspname = 'public' and c.relkind = 'r'
              and not (c.relname = any (fora)) order by c.relname
  loop
    execute format('select count(*) from public.%I', r.relname) into n;
    if n <> 0 then ruins := ruins || r.relname || '=' || n || ' '; end if;
  end loop;
  return coalesce(nullif(rtrim(ruins), ''), 'nenhuma');
end $$;

create function pg_temp.tabelas_vazias()
returns text language plpgsql as $$
declare r record; n bigint; ruins text := '';
begin
  for r in select c.relname from pg_class c join pg_namespace s on s.oid = c.relnamespace
            where s.nspname = 'public' and c.relkind = 'r' order by c.relname
  loop
    execute format('select count(*) from public.%I', r.relname) into n;
    if n = 0 then ruins := ruins || r.relname || ' '; end if;
  end loop;
  return coalesce(nullif(rtrim(ruins), ''), 'nenhuma');
end $$;

create function pg_temp.views_com_linha()
returns text language plpgsql as $$
declare r record; n bigint; ruins text := '';
begin
  for r in select c.relname from pg_class c join pg_namespace s on s.oid = c.relnamespace
            where s.nspname = 'public' and c.relkind = 'v' order by c.relname
  loop
    execute format('select count(*) from public.%I', r.relname) into n;
    if n <> 0 then ruins := ruins || r.relname || '=' || n || ' '; end if;
  end loop;
  return coalesce(nullif(rtrim(ruins), ''), 'nenhuma');
end $$;


-- ---------------------------------------------------------------------
-- 1 a 7 · o catálogo: o que vale sem depender de nenhuma linha
-- ---------------------------------------------------------------------

select pg_temp.confere(1,'toda tabela de public tem RLS ligada',
  (select coalesce(string_agg(c.relname, ', ' order by c.relname), 'nenhuma')
     from pg_class c join pg_namespace s on s.oid = c.relnamespace
    where s.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity), 'nenhuma');

select pg_temp.confere(2,'toda tabela de public tem ao menos uma policy',
  (select coalesce(string_agg(c.relname, ', ' order by c.relname), 'nenhuma')
     from pg_class c join pg_namespace s on s.oid = c.relnamespace
    where s.nspname = 'public' and c.relkind = 'r'
      and not exists (select 1 from pg_policies p
                       where p.schemaname = 'public' and p.tablename = c.relname)), 'nenhuma');

-- `ping` é a única exceção do projeto: não tem dono, não guarda nada de
-- ninguém, e é legível sem login de propósito. Qualquer OUTRA policy que
-- alcance `anon` é um vazamento.
select pg_temp.confere(3,'só ping dá acesso a anon',
  (select coalesce(string_agg(tablename || '.' || policyname, ', ' order by tablename), 'nenhuma')
     from pg_policies
    where schemaname = 'public' and 'anon' = any (roles) and tablename <> 'ping'), 'nenhuma');

-- O defeito da 012 morava aqui: função nova no Supabase nasce com execute para
-- anon, e `revoke from public` não tira concessão explícita de papel.
select pg_temp.confere(4,'anon não executa nenhuma função de public',
  (select coalesce(string_agg(p.proname, ', ' order by p.proname), 'nenhuma')
     from pg_proc p join pg_namespace s on s.oid = p.pronamespace
    where s.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')), 'nenhuma');

-- View sem `security_invoker` roda como dona e entrega linha de qualquer
-- pessoa. Ela continua funcionando -- só que para todo mundo.
select pg_temp.confere(5,'toda view é security_invoker',
  (select coalesce(string_agg(c.relname, ', ' order by c.relname), 'nenhuma')
     from pg_class c join pg_namespace s on s.oid = c.relnamespace
    where s.nspname = 'public' and c.relkind = 'v'
      and coalesce((select option_value from pg_options_to_table(c.reloptions)
                     where option_name = 'security_invoker'), 'false') not in ('true','on')), 'nenhuma');

select pg_temp.confere(6,'toda tabela com user_id tem gatilho que preenche o dono',
  (select coalesce(string_agg(c.relname, ', ' order by c.relname), 'nenhuma')
     from pg_class c join pg_namespace s on s.oid = c.relnamespace
    where s.nspname = 'public' and c.relkind = 'r'
      and exists (select 1 from pg_attribute a where a.attrelid = c.oid
                   and a.attname = 'user_id' and a.attnum > 0 and not a.attisdropped)
      and not exists (select 1 from pg_trigger t where t.tgrelid = c.oid and not t.tgisinternal
                       and t.tgname like '%set_user%')), 'nenhuma');

-- Sem `search_path` fixo, quem chama escolhe em que schema os nomes de dentro
-- do corpo são resolvidos. É caminho conhecido de escalada de privilégio.
select pg_temp.confere(7,'toda função de public tem search_path fixo',
  (select coalesce(string_agg(p.proname, ', ' order by p.proname), 'nenhuma')
     from pg_proc p join pg_namespace s on s.oid = p.pronamespace
    where s.nspname = 'public'
      and not exists (select 1 from unnest(coalesce(p.proconfig, array[]::text[])) cfg
                       where cfg like 'search_path=%')), 'nenhuma');


-- ---------------------------------------------------------------------
-- cenário: o usuário A enche TODAS as vinte e quatro tabelas
-- ---------------------------------------------------------------------
-- Vale a pena encher todas, e não uma amostra: a varredura só prova alguma
-- coisa sobre uma tabela que TEM linha. Tabela vazia devolve zero para
-- qualquer um, inclusive para quem não deveria poder olhar.

insert into auth.users (id) values
  ('11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222222');

insert into public.config (user_id, renda) values
  ('11111111-1111-4111-8111-111111111111', 5000.00);

insert into public.instituicoes (id, user_id, nome) values
  ('aaaa0001-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','Instituição Um');

insert into public.contas (id, user_id, instituicao_id, nome, saldo_inicial, saldo_inicial_em) values
  ('bbbb0001-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111',
   'aaaa0001-0000-4000-8000-000000000001','Conta Um', 1000.00, '2026-01-01');

insert into public.categorias (id, user_id, nome, fluxo) values
  ('cccc0001-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','Raiz Um','saida');

insert into public.credores (id, user_id, nome) values
  ('eeee0001-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','Credor Um');

insert into public.cartoes (id, user_id, instituicao_id, nome, dia_fechamento, dia_vencimento,
                           conta_padrao_id) values
  ('ffff0001-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111',
   'aaaa0001-0000-4000-8000-000000000001','Cartão Um', 10, 20,
   'bbbb0001-0000-4000-8000-000000000001');

insert into public.faturas (id, user_id, cartao_id, competencia, abertura, fechamento, vencimento) values
  ('ffff0002-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111',
   'ffff0001-0000-4000-8000-000000000001','2026-03','2026-02-10','2026-03-10','2026-03-20');

insert into public.compras_de_cartao (id, user_id, cartao_id, descricao, valor_total,
                                      data_compra, total_parcelas) values
  ('ffff0003-0000-4000-8000-000000000003','11111111-1111-4111-8111-111111111111',
   'ffff0001-0000-4000-8000-000000000001','Compra Um', 300.00, '2026-02-15', 1);

insert into public.assinaturas (id, user_id, nome, valor, inicio, conta_id) values
  ('dddd0001-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111',
   'Assinatura Um', 30.00, '2026-01-05','bbbb0001-0000-4000-8000-000000000001');

-- Três transações: uma comum, uma parcela de cartão (mora na fatura, não na
-- conta) e uma ocorrência de assinatura (identificada por `ocorrencia_em`).
insert into public.transacoes (id, user_id, conta_id, categoria_id, tipo, natureza,
                               descricao, valor, data) values
  ('99990001-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111',
   'bbbb0001-0000-4000-8000-000000000001','cccc0001-0000-4000-8000-000000000001',
   'saida','normal','Lançamento Um', 100.00, '2026-02-01');
insert into public.transacoes (id, user_id, fatura_id, compra_id, parcela, total_parcelas,
                               tipo, natureza, descricao, valor, data, origem, origem_id) values
  ('99990002-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111',
   'ffff0002-0000-4000-8000-000000000002','ffff0003-0000-4000-8000-000000000003', 1, 1,
   'saida','normal','Compra Um', 300.00, '2026-02-15','cartao','ffff0003-0000-4000-8000-000000000003');
insert into public.transacoes (id, user_id, conta_id, assinatura_id, competencia, ocorrencia_em,
                               tipo, natureza, descricao, valor, data, status, origem) values
  ('99990003-0000-4000-8000-000000000003','11111111-1111-4111-8111-111111111111',
   'bbbb0001-0000-4000-8000-000000000001','dddd0001-0000-4000-8000-000000000001',
   '2026-02','2026-02-05','saida','normal','Assinatura Um', 30.00,'2026-02-05',
   'prevista','recorrencia');

insert into public.dividas (id, user_id, credor, descricao, valor, mes_inicial, credor_id) values
  ('77770001-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111',
   'Credor Um','Dívida Um', 600.00,'2026-01','eeee0001-0000-4000-8000-000000000001');

insert into public.fixas (id, user_id, nome, valor, variavel) values
  ('77770002-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111',
   'Conta Fixa Um', 200.00, true);

insert into public.fixas_mes (user_id, fixa_id, mes, valor) values
  ('11111111-1111-4111-8111-111111111111','77770002-0000-4000-8000-000000000002','2026-02', 210.00);

insert into public.receitas (id, user_id, descricao, valor, tipo, mes_inicial) values
  ('77770003-0000-4000-8000-000000000003','11111111-1111-4111-8111-111111111111',
   'Receita Um', 4000.00,'mensal','2026-01');

insert into public.pagamentos (user_id, mes, item_id) values
  ('11111111-1111-4111-8111-111111111111','2026-02','77770001-0000-4000-8000-000000000001');

insert into public.liquidacoes (user_id, tipo, item_id, competencia, transacao_id, valor) values
  ('11111111-1111-4111-8111-111111111111','divida','77770001-0000-4000-8000-000000000001',
   '2026-02','99990001-0000-4000-8000-000000000001', 100.00);

insert into public.grupos (id, user_id, nome) values
  ('66660001-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','Grupo Um');

insert into public.membros (id, user_id, grupo_id, nome, sou_eu) values
  ('66660002-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111',
   '66660001-0000-4000-8000-000000000001','Pessoa Um', true),
  ('66660003-0000-4000-8000-000000000003','11111111-1111-4111-8111-111111111111',
   '66660001-0000-4000-8000-000000000001','Pessoa Dois', false);

insert into public.despesas_do_grupo (id, user_id, grupo_id, pago_por_id, descricao, valor, data) values
  ('66660004-0000-4000-8000-000000000004','11111111-1111-4111-8111-111111111111',
   '66660001-0000-4000-8000-000000000001','66660002-0000-4000-8000-000000000002',
   'Despesa Um', 80.00, '2026-02-10');

insert into public.rateios (user_id, despesa_id, membro_id, valor) values
  ('11111111-1111-4111-8111-111111111111','66660004-0000-4000-8000-000000000004',
   '66660002-0000-4000-8000-000000000002', 40.00),
  ('11111111-1111-4111-8111-111111111111','66660004-0000-4000-8000-000000000004',
   '66660003-0000-4000-8000-000000000003', 40.00);

insert into public.acertos (user_id, grupo_id, de_id, para_id, valor, data) values
  ('11111111-1111-4111-8111-111111111111','66660001-0000-4000-8000-000000000001',
   '66660003-0000-4000-8000-000000000003','66660002-0000-4000-8000-000000000002', 40.00,'2026-02-11');

insert into public.metas (id, user_id, nome, valor_alvo) values
  ('55550001-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','Meta Um', 2000.00);

insert into public.alocacoes_de_meta (user_id, meta_id, valor, data) values
  ('11111111-1111-4111-8111-111111111111','55550001-0000-4000-8000-000000000001', 500.00,'2026-02-01');

insert into public.ping (id) values (1);

-- A varredura só vale se NENHUMA tabela tiver ficado vazia: tabela vazia
-- devolve zero para qualquer papel e passaria de graça no caso 9.
select pg_temp.confere(8,'o cenário não deixou nenhuma tabela vazia',
  pg_temp.tabelas_vazias(), 'nenhuma');


-- ---------------------------------------------------------------------
-- 9 a 14 · o outro usuário: enxerga, grava, executa?
-- ---------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222"}';

-- `ping` fica de fora: ela não tem dono, e ser legível por todos é o contrato
-- dela, não um defeito.
select pg_temp.confere(9,'o outro usuário não enxerga NENHUMA linha de NENHUMA tabela',
  pg_temp.tabelas_com_linha(array['ping']), 'nenhuma');

select pg_temp.confere(10,'nem por NENHUMA view',
  pg_temp.views_com_linha(), 'nenhuma');

select pg_temp.deve_falhar(11,'o outro usuário não grava com o dono alheio', $cmd$
  insert into public.contas (user_id, nome) values
    ('11111111-1111-4111-8111-111111111111','Conta Invadida')
$cmd$);

-- Sem `user_id`, o gatilho preenche com quem está logado -- então a linha
-- nasce do OUTRO, e não de A. O que se prova aqui é que ela não vira linha de
-- A por omissão.
insert into public.contas (nome) values ('Conta do Outro');
select pg_temp.confere(12,'linha sem user_id nasce de quem está logado',
  (select user_id from public.contas where nome = 'Conta do Outro'),
  '22222222-2222-4222-8222-222222222222'::uuid);

-- Um `update` por id de linha alheia NÃO dá erro: ele alcança zero linhas, em
-- silêncio. É a forma mais discreta de um RLS quebrado se parecer com um RLS
-- inteiro, e por isso o caso mede as linhas atingidas, e não o erro.
do $$
declare atingidas int;
begin
  update public.transacoes set valor = 1
   where id = '99990001-0000-4000-8000-000000000001';
  get diagnostics atingidas = row_count;
  insert into resultado values (13,'update por id em linha alheia atinge zero linhas',
    atingidas = 0, 'atingidas ' || atingidas);
end $$;

do $$
declare atingidas int;
begin
  delete from public.transacoes where id = '99990001-0000-4000-8000-000000000001';
  get diagnostics atingidas = row_count;
  insert into resultado values (14,'delete por id em linha alheia atinge zero linhas',
    atingidas = 0, 'atingidas ' || atingidas);
end $$;

reset role;


-- ---------------------------------------------------------------------
-- 15 a 19 · anon: o visitante que não fez login
-- ---------------------------------------------------------------------
set local role anon;
set local request.jwt.claims = '';

select pg_temp.confere(15,'anon não enxerga NENHUMA linha de NENHUMA tabela',
  pg_temp.tabelas_com_linha(array['ping']), 'nenhuma');

select pg_temp.confere(16,'nem por NENHUMA view',
  pg_temp.views_com_linha(), 'nenhuma');

-- A exceção declarada, e ela precisa continuar funcionando: é assim que o site
-- sabe que o banco responde antes de pedir senha.
select pg_temp.confere(17,'anon LÊ ping, que é a exceção de propósito',
  (select count(*) from public.ping), 1::bigint);

select pg_temp.deve_falhar(18,'anon não grava em conta', $cmd$
  insert into public.contas (nome) values ('Conta Anônima')
$cmd$);

select pg_temp.deve_falhar(19,'anon não grava nem em ping, que ele lê', $cmd$
  insert into public.ping (id) values (2)
$cmd$);

reset role;


-- ---------------------------------------------------------------------
-- 20 · o dono continua enxergando o que é dele
-- ---------------------------------------------------------------------
-- O contrário do resto do arquivo, e não é redundância: um schema que negasse
-- tudo a todo mundo passaria em todos os casos acima.
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111"}';

select pg_temp.confere(20,'o dono enxerga as três transações dele',
  (select count(*) from public.transacoes), 3::bigint);
select pg_temp.confere(22,'e o valor que o outro tentou alterar continua o que era',
  (select valor from public.transacoes
    where id = '99990001-0000-4000-8000-000000000001'), 100.00::numeric);
-- 1000 de saldo inicial menos 100. Das três transações, só uma toca a conta: a
-- parcela de cartão mora na fatura, e a ocorrência de assinatura ainda está
-- `prevista`. Saldo é o que já saiu, não o que vai sair.
select pg_temp.confere(21,'e o saldo da conta dele sai pela view',
  (select saldo from public.saldos_de_conta where nome = 'Conta Um'), 900.00::numeric);

reset role;


-- ---------------------------------------------------------------------
select n, case when passou then 'ok' else 'FALHOU' end as estado, caso, detalhe
  from resultado order by n;

select count(*) filter (where passou) as passaram,
       count(*) filter (where not passou) as falharam,
       coalesce(string_agg(caso, ' · ') filter (where not passou), '(nenhuma)') as falhas
  from resultado;

rollback;
