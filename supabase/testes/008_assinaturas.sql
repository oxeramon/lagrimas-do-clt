-- =====================================================================
-- TESTES DE ASSINATURA E RECORRÊNCIA · contrato da 008
-- =====================================================================
-- Roda inteiro dentro de uma transação e termina em `rollback`.
--
-- Como nas anteriores, o miolo roda com `set local role authenticated` e um
-- `request.jwt.claims` montado à mão. Teste de autorização como `postgres`
-- não prova nada.
--
-- A propriedade central aqui é a IDEMPOTÊNCIA: materializar duas vezes não
-- pode criar ocorrência repetida. Se isso quebrar, chamar a geração a cada
-- carga da tela -- que é o plano -- encheria o banco de duplicatas.
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

insert into public.cartoes (id, user_id, nome, dia_fechamento, dia_vencimento) values
  ('cccc0001-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','Cartão Exemplo',10,20);

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111"}';

-- ---------------------------------------------------------------------
-- 1 a 5 · custo equivalente: comparar anual com mensal sem conta de cabeça
-- ---------------------------------------------------------------------
insert into public.assinaturas (id, nome, valor, frequencia, conta_id, inicio) values
  ('dddd0001-0000-4000-8000-000000000001','Mensal Exemplo', 30.00,'mensal',
   'bbbb0001-0000-4000-8000-000000000001', current_date - interval '3 months'),
  ('dddd0002-0000-4000-8000-000000000002','Anual Exemplo', 120.00,'anual',
   'bbbb0001-0000-4000-8000-000000000001', current_date - interval '1 month'),
  ('dddd0003-0000-4000-8000-000000000003','No Cartão', 20.00,'mensal', null,
   current_date - interval '1 month');
update public.assinaturas set cartao_id = 'cccc0001-0000-4000-8000-000000000001'
 where id = 'dddd0003-0000-4000-8000-000000000003';

select pg_temp.confere(1,'mensal: custo mensal é o próprio valor',
  (select custo_mensal from public.assinaturas_resolvidas where nome='Mensal Exemplo'), 30.00::numeric);
select pg_temp.confere(2,'mensal: custo anual é doze vezes',
  (select custo_anual from public.assinaturas_resolvidas where nome='Mensal Exemplo'), 360.00::numeric);
select pg_temp.confere(3,'anual: custo mensal equivalente é um doze avos',
  (select custo_mensal from public.assinaturas_resolvidas where nome='Anual Exemplo'), 10.00::numeric);
select pg_temp.confere(4,'anual: custo anual é o próprio valor',
  (select custo_anual from public.assinaturas_resolvidas where nome='Anual Exemplo'), 120.00::numeric);
select pg_temp.confere(5,'sem ocorrência gerada, a próxima cobrança é null e não hoje',
  (select proxima_cobranca from public.assinaturas_resolvidas where nome='Mensal Exemplo'), null::date);

-- ---------------------------------------------------------------------
-- 6 a 12 · materializar, e materializar de novo
-- ---------------------------------------------------------------------
insert into ids select 'criadas1',
  public.materializa_assinaturas((current_date + interval '2 months')::date)::text;

select pg_temp.confere(6,'a primeira geração cria ocorrências',
  ((select valor from ids where chave='criadas1')::int > 0), true);
select pg_temp.confere(7,'e todas nascem previstas: elas ainda não aconteceram',
  (select count(*) from public.transacoes
    where assinatura_id is not null and status <> 'prevista'), 0::bigint);
select pg_temp.confere(8,'cada ocorrência sabe de qual período ela é',
  (select count(*) from public.transacoes
    where assinatura_id is not null and competencia is null), 0::bigint);

-- A PROPRIEDADE QUE TORNA SEGURO CHAMAR ISTO A CADA CARGA DA TELA
insert into ids select 'criadas2',
  public.materializa_assinaturas((current_date + interval '2 months')::date)::text;
select pg_temp.confere(9,'a segunda geração não cria nada: a idempotência é do BANCO',
  (select valor from ids where chave='criadas2'), '0');
select pg_temp.confere(10,'e não existe competência repetida por assinatura',
  (select count(*) from (
     select assinatura_id, competencia from public.transacoes
      where assinatura_id is not null
      group by assinatura_id, competencia having count(*) > 1) d), 0::bigint);
select pg_temp.deve_falhar(11,'a duplicata é recusada pelo banco, não por um if', $cmd$
  insert into public.transacoes (assinatura_id, competencia, tipo, natureza, descricao,
                                 valor, data, status)
  select assinatura_id, competencia, 'saida','normal','duplicata', 1, current_date, 'prevista'
    from public.transacoes where assinatura_id is not null limit 1 $cmd$);
select pg_temp.confere(12,'agora a próxima cobrança existe, e é a mais próxima no futuro',
  (select proxima_cobranca >= current_date from public.assinaturas_resolvidas
    where nome='Mensal Exemplo'), true);

-- ---------------------------------------------------------------------
-- 13 a 16 · assinatura no cartão cai na FATURA, não na conta
-- ---------------------------------------------------------------------
select pg_temp.confere(13,'a ocorrência do cartão entra numa fatura',
  (select count(*) from public.transacoes
    where assinatura_id='dddd0003-0000-4000-8000-000000000003' and fatura_id is null), 0::bigint);
select pg_temp.confere(14,'e não sai de conta nenhuma',
  (select count(*) from public.transacoes
    where assinatura_id='dddd0003-0000-4000-8000-000000000003' and conta_id is not null), 0::bigint);
select pg_temp.confere(15,'a fatura foi criada sob demanda pela geração',
  ((select count(*) from public.faturas) > 0), true);
-- previsto não entra no total da fatura: ele só conta o que aconteceu
select pg_temp.confere(16,'ocorrência prevista NÃO engorda o total da fatura',
  (select coalesce(sum(total),0) from public.faturas_resolvidas), 0::numeric);

-- ---------------------------------------------------------------------
-- 17 a 20 · prevista não é dinheiro
-- ---------------------------------------------------------------------
select pg_temp.confere(17,'o saldo da conta não se mexe com ocorrência prevista',
  (select saldo from public.saldos_de_conta where conta_id='bbbb0001-0000-4000-8000-000000000001'),
  1000.00::numeric);
select pg_temp.confere(18,'e o consumo do período também não',
  (select coalesce(sum(valor),0) from public.transacoes
    where tipo='saida' and natureza='normal' and status in ('realizada','conciliada')),
  0::numeric);
-- confirmar uma cobrança é mudar o status, e aí sim ela vira dinheiro
update public.transacoes set status='realizada'
 where assinatura_id='dddd0001-0000-4000-8000-000000000001'
   and data = (select min(data) from public.transacoes
                where assinatura_id='dddd0001-0000-4000-8000-000000000001');
select pg_temp.confere(19,'confirmada, ela sai da conta',
  (select saldo from public.saldos_de_conta where conta_id='bbbb0001-0000-4000-8000-000000000001'),
  970.00::numeric);
select pg_temp.confere(20,'e passa a contar como consumo',
  (select coalesce(sum(valor),0) from public.transacoes
    where tipo='saida' and natureza='normal' and status in ('realizada','conciliada')),
  30.00::numeric);

-- ---------------------------------------------------------------------
-- 21 a 25 · o que a assinatura recusa
-- ---------------------------------------------------------------------
select pg_temp.deve_falhar(21,'conta E cartão ao mesmo tempo é recusado', $cmd$
  insert into public.assinaturas (nome, valor, inicio, conta_id, cartao_id)
  values ('Impossível', 10, current_date,
          'bbbb0001-0000-4000-8000-000000000001','cccc0001-0000-4000-8000-000000000001') $cmd$);
select pg_temp.deve_falhar(22,'valor zero é recusado', $cmd$
  insert into public.assinaturas (nome, valor, inicio) values ('Zero', 0, current_date) $cmd$);
select pg_temp.deve_falhar(23,'fim antes do início é recusado', $cmd$
  insert into public.assinaturas (nome, valor, inicio, fim)
  values ('Invertida', 10, current_date, current_date - interval '1 month') $cmd$);
select pg_temp.deve_falhar(24,'frequência inventada é recusada', $cmd$
  insert into public.assinaturas (nome, valor, inicio, frequencia)
  values ('Quinzenal', 10, current_date, 'quinzenal') $cmd$);
-- sem conta e sem cartão é ESTADO VÁLIDO: "ainda não decidi por onde pago"
insert into public.assinaturas (id, nome, valor, inicio)
values ('dddd0004-0000-4000-8000-000000000004','Sem Meio', 15.00, current_date);
select pg_temp.confere(25,'sem conta e sem cartão é aceito: é um estado real',
  (select count(*) from public.assinaturas where nome='Sem Meio'), 1::bigint);

-- ---------------------------------------------------------------------
-- 26 a 29 · a janela, o fim e a semanal
-- ---------------------------------------------------------------------
select pg_temp.deve_falhar(26,'janela de geração absurda é recusada', $cmd$
  select public.materializa_assinaturas((current_date + interval '40 months')::date) $cmd$);

insert into public.assinaturas (id, nome, valor, inicio, fim, conta_id)
values ('dddd0005-0000-4000-8000-000000000005','Acaba Já', 40.00,
        current_date, current_date + interval '10 days',
        'bbbb0001-0000-4000-8000-000000000001');
select public.materializa_assinaturas((current_date + interval '2 months')::date);
select pg_temp.confere(27,'assinatura com fim próximo gera só o que cabe antes dele',
  (select count(*) from public.transacoes
    where assinatura_id='dddd0005-0000-4000-8000-000000000005'), 1::bigint);

insert into public.assinaturas (id, nome, valor, frequencia, inicio, conta_id)
values ('dddd0006-0000-4000-8000-000000000006','Semanal Exemplo', 9.00,'semanal',
        current_date, 'bbbb0001-0000-4000-8000-000000000001');
select public.materializa_assinaturas((current_date + interval '2 months')::date);
select pg_temp.confere(28,'semanal fica fora da geração, e a exclusão é declarada',
  (select count(*) from public.transacoes
    where assinatura_id='dddd0006-0000-4000-8000-000000000006'), 0::bigint);
select pg_temp.confere(29,'mas ela entra no custo equivalente: 52 semanas por ano',
  (select custo_anual from public.assinaturas_resolvidas where nome='Semanal Exemplo'),
  468.00::numeric);

-- ---------------------------------------------------------------------
-- 30 · assinatura inativa não gera nada
-- ---------------------------------------------------------------------
update public.assinaturas set ativo = false where id='dddd0002-0000-4000-8000-000000000002';
delete from public.transacoes where assinatura_id='dddd0002-0000-4000-8000-000000000002';
select public.materializa_assinaturas((current_date + interval '2 months')::date);
select pg_temp.confere(30,'assinatura desligada para de gerar cobrança',
  (select count(*) from public.transacoes
    where assinatura_id='dddd0002-0000-4000-8000-000000000002'), 0::bigint);

-- ---------------------------------------------------------------------
-- 31 a 35 · o outro usuário e o anônimo
-- ---------------------------------------------------------------------
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222"}';
select pg_temp.confere(31,'o outro usuário não enxerga assinatura alheia',
  (select count(*) from public.assinaturas), 0::bigint);
select pg_temp.confere(32,'nem pela view',
  (select count(*) from public.assinaturas_resolvidas), 0::bigint);
select pg_temp.confere(33,'e gerar não cria nada para ele',
  public.materializa_assinaturas((current_date + interval '2 months')::date), 0);

reset role;
set local role anon;
set local request.jwt.claims = '';
select pg_temp.confere(34,'anon não enxerga assinatura nenhuma',
  (select count(*) from public.assinaturas), 0::bigint);
select pg_temp.deve_falhar(35,'anon não executa materializa_assinaturas', $cmd$
  select public.materializa_assinaturas(null) $cmd$);

reset role;
select n, case when passou then 'ok' else 'FALHOU' end as situacao, caso, detalhe
  from resultado order by n;

rollback;
