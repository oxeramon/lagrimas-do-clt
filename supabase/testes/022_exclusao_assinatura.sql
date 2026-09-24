-- Testa a exclusao com o mesmo papel usado pelo aplicativo.
-- Tudo e revertido ao final, inclusive o usuario ficticio.
begin;

insert into auth.users (id) values ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');
insert into public.contas (id, user_id, nome, saldo_inicial, saldo_inicial_em)
values ('bbbb0022-0000-4000-8000-000000000001',
        'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'Conta teste exclusao', 100, '2026-01-01');

set local role authenticated;
set local request.jwt.claims = '{"sub":"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"}';

insert into public.assinaturas (id, nome, valor, frequencia, conta_id, inicio)
values ('dddd0022-0000-4000-8000-000000000001', 'Assinatura teste exclusao',
        10, 'mensal', 'bbbb0022-0000-4000-8000-000000000001', '2026-01-01');

insert into public.transacoes
  (id, assinatura_id, competencia, ocorrencia_em, conta_id, tipo, natureza,
   descricao, valor, data, status, origem)
values
  ('aaaa0022-0000-4000-8000-000000000001',
   'dddd0022-0000-4000-8000-000000000001', '2026-01', '2026-01-01',
   'bbbb0022-0000-4000-8000-000000000001', 'saida', 'normal',
   'Cobranca teste', 10, '2026-01-01', 'realizada', 'recorrencia'),
  ('aaaa0022-0000-4000-8000-000000000002',
   'dddd0022-0000-4000-8000-000000000001', '2026-02', '2026-02-01',
   'bbbb0022-0000-4000-8000-000000000001', 'saida', 'normal',
   'Cobranca teste', 10, '2026-02-01', 'prevista', 'recorrencia');

delete from public.assinaturas
where id = 'dddd0022-0000-4000-8000-000000000001';

do $$
begin
  if exists (select 1 from public.assinaturas
             where id = 'dddd0022-0000-4000-8000-000000000001') then
    raise exception 'A assinatura permaneceu';
  end if;

  if (select count(*) from public.transacoes
      where id in ('aaaa0022-0000-4000-8000-000000000001',
                   'aaaa0022-0000-4000-8000-000000000002')
        and assinatura_id is null and ocorrencia_em is null
        and valor = 10 and data in ('2026-01-01', '2026-02-01')) <> 2 then
    raise exception 'Os lancamentos nao foram preservados';
  end if;
end $$;

reset role;
rollback;

