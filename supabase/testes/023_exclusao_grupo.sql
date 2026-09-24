-- Excluir um grupo apaga seus filhos em cascata; excluir um membro isolado
-- continua proibido enquanto houver despesas ou rateios ligados a ele.
-- Toda a massa ficticia e revertida.
begin;

insert into auth.users (id) values ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');
set local role authenticated;
set local request.jwt.claims = '{"sub":"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"}';

insert into public.grupos (id, nome) values
  ('99990023-0000-4000-8000-000000000001', 'Grupo teste exclusao'),
  ('99990023-0000-4000-8000-000000000002', 'Grupo teste protecao');
insert into public.membros (id, grupo_id, nome, sou_eu) values
  ('77770023-0000-4000-8000-000000000001', '99990023-0000-4000-8000-000000000001', 'Eu', true),
  ('77770023-0000-4000-8000-000000000002', '99990023-0000-4000-8000-000000000001', 'Pessoa B', false),
  ('77770023-0000-4000-8000-000000000003', '99990023-0000-4000-8000-000000000002', 'Eu', true),
  ('77770023-0000-4000-8000-000000000004', '99990023-0000-4000-8000-000000000002', 'Pessoa B', false);

do $$
begin
  perform public.registra_despesa_do_grupo(
    '99990023-0000-4000-8000-000000000001', 'Despesa teste', 20, '2026-09-01',
    '77770023-0000-4000-8000-000000000001',
    '[{"membro":"77770023-0000-4000-8000-000000000001","valor":10},
      {"membro":"77770023-0000-4000-8000-000000000002","valor":10}]'::jsonb);
  perform public.registra_acerto(
    '99990023-0000-4000-8000-000000000001',
    '77770023-0000-4000-8000-000000000002',
    '77770023-0000-4000-8000-000000000001', 10, '2026-09-02');
  perform public.registra_despesa_do_grupo(
    '99990023-0000-4000-8000-000000000002', 'Despesa protegida', 20, '2026-09-01',
    '77770023-0000-4000-8000-000000000003',
    '[{"membro":"77770023-0000-4000-8000-000000000003","valor":10},
      {"membro":"77770023-0000-4000-8000-000000000004","valor":10}]'::jsonb);
end $$;

delete from public.grupos where id = '99990023-0000-4000-8000-000000000001';
set constraints all immediate;

do $$
declare bloqueou boolean := false;
begin
  if exists (select 1 from public.grupos where id = '99990023-0000-4000-8000-000000000001')
     or exists (select 1 from public.membros where grupo_id = '99990023-0000-4000-8000-000000000001')
     or exists (select 1 from public.despesas_do_grupo where grupo_id = '99990023-0000-4000-8000-000000000001')
     or exists (select 1 from public.acertos where grupo_id = '99990023-0000-4000-8000-000000000001') then
    raise exception 'O grupo e seus filhos nao foram removidos';
  end if;

  begin
    delete from public.membros where id = '77770023-0000-4000-8000-000000000003';
  exception when foreign_key_violation then
    bloqueou := true;
  end;
  if not bloqueou then
    raise exception 'A exclusao isolada de membro foi aceita';
  end if;
end $$;

reset role;
rollback;

