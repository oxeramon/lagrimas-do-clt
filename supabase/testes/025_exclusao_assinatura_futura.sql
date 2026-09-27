-- Testa a exclusao com o mesmo papel usado pelo aplicativo.
-- Tudo e revertido ao final, inclusive o usuario sintetico.
begin;

insert into auth.users (id)
values ('eeee0025-0000-4000-8000-000000000001');

insert into public.contas
  (id, user_id, nome, saldo_inicial, saldo_inicial_em)
values
  ('bbbb0025-0000-4000-8000-000000000001',
   'eeee0025-0000-4000-8000-000000000001',
   'Conta sintetica 025', 100, current_date - 365);

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"eeee0025-0000-4000-8000-000000000001"}';

insert into public.assinaturas
  (id, nome, valor, frequencia, conta_id, inicio)
values
  ('dddd0025-0000-4000-8000-000000000001',
   'Assinatura sintetica 025', 10, 'mensal',
   'bbbb0025-0000-4000-8000-000000000001',
   current_date - 60);

insert into public.transacoes
  (id, assinatura_id, competencia, ocorrencia_em, conta_id, tipo, natureza,
   descricao, valor, data, status, origem)
values
  ('aaaa0025-0000-4000-8000-000000000001',
   'dddd0025-0000-4000-8000-000000000001',
   to_char(current_date - 30, 'YYYY-MM'), current_date - 30,
   'bbbb0025-0000-4000-8000-000000000001',
   'saida', 'normal', 'Passada realizada sintetica', 10,
   current_date - 30, 'realizada', 'recorrencia'),
  ('aaaa0025-0000-4000-8000-000000000002',
   'dddd0025-0000-4000-8000-000000000001',
   to_char(current_date - 1, 'YYYY-MM'), current_date - 1,
   'bbbb0025-0000-4000-8000-000000000001',
   'saida', 'normal', 'Passada prevista sintetica', 10,
   current_date - 1, 'prevista', 'recorrencia'),
  ('aaaa0025-0000-4000-8000-000000000003',
   'dddd0025-0000-4000-8000-000000000001',
   to_char(current_date, 'YYYY-MM'), current_date,
   'bbbb0025-0000-4000-8000-000000000001',
   'saida', 'normal', 'Hoje prevista sintetica', 10,
   current_date, 'prevista', 'recorrencia'),
  ('aaaa0025-0000-4000-8000-000000000004',
   'dddd0025-0000-4000-8000-000000000001',
   to_char(current_date + 30, 'YYYY-MM'), current_date + 30,
   'bbbb0025-0000-4000-8000-000000000001',
   'saida', 'normal', 'Futura prevista sintetica', 10,
   current_date + 30, 'prevista', 'recorrencia'),
  ('aaaa0025-0000-4000-8000-000000000005',
   'dddd0025-0000-4000-8000-000000000001',
   to_char(current_date + 60, 'YYYY-MM'), current_date + 60,
   'bbbb0025-0000-4000-8000-000000000001',
   'saida', 'normal', 'Futura realizada sintetica', 10,
   current_date + 60, 'realizada', 'recorrencia');

delete from public.assinaturas
 where id = 'dddd0025-0000-4000-8000-000000000001';

do $$
begin
  if exists (
    select 1 from public.assinaturas
     where id = 'dddd0025-0000-4000-8000-000000000001'
  ) then
    raise exception 'A assinatura permaneceu';
  end if;

  if exists (
    select 1 from public.transacoes
     where id in ('aaaa0025-0000-4000-8000-000000000003',
                  'aaaa0025-0000-4000-8000-000000000004')
  ) then
    raise exception 'Ocorrencias previstas de hoje ou do futuro permaneceram';
  end if;

  if (
    select count(*) from public.transacoes
     where id in ('aaaa0025-0000-4000-8000-000000000001',
                  'aaaa0025-0000-4000-8000-000000000002',
                  'aaaa0025-0000-4000-8000-000000000005')
       and assinatura_id is null
       and ocorrencia_em is null
  ) <> 3 then
    raise exception 'O historico ou uma ocorrencia realizada nao foi preservado';
  end if;
end $$;

reset role;
rollback;
