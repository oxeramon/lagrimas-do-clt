-- Restaura um backup de um usuário para uma conta vazia, atomicamente.
-- Executar somente após testar numa base descartável. A função usa os direitos
-- do chamador; RLS e as FKs compostas continuam valendo durante a restauração.
create or replace function public.restaura_backup_integral(p_backup jsonb)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  dono uuid := auth.uid();
  origem uuid;
  nomes text[] := array[
    'config','instituicoes','contas','categorias','credores','fixas',
    'fixas_mes','dividas','receitas','pagamentos','cartoes','faturas',
    'compras_de_cartao','assinaturas','transacoes','liquidacoes','grupos',
    'membros','despesas_do_grupo','rateios','acertos','metas',
    'alocacoes_de_meta','competencias_de_regra'
  ];
  nome text;
  qtd integer;
  ocupado boolean;
  total integer := 0;
begin
  if dono is null then raise exception 'Faça login para restaurar.'; end if;
  if p_backup->>'formato' is distinct from 'lagrimas-do-clt/backup-integral'
     or p_backup->>'versao' is distinct from '1' then
    raise exception 'Formato de backup incompatível.';
  end if;
  origem := (p_backup->>'origem_user_id')::uuid;
  if origem is null or jsonb_typeof(p_backup->'tabelas') is distinct from 'object'
     or (select array_agg(k order by k) from jsonb_object_keys(p_backup->'tabelas') k)
        is distinct from (select array_agg(k order by k) from unnest(nomes) k) then
    raise exception 'Backup incompleto.';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(dono::text, 219));
  foreach nome in array nomes loop
    if jsonb_typeof(p_backup->'tabelas'->nome) is distinct from 'array'
       or exists (select 1 from jsonb_array_elements(p_backup->'tabelas'->nome) x
                  where jsonb_typeof(x) is distinct from 'object'
                     or x->>'user_id' is distinct from origem::text) then
      raise exception 'Dados inválidos em %.', nome;
    end if;
    execute pg_catalog.format('select exists(select 1 from public.%I where user_id = $1)', nome)
      into strict ocupado using dono;
    if ocupado then raise exception 'A conta de destino precisa estar vazia.'; end if;
  end loop;
  foreach nome in array nomes loop
    execute pg_catalog.format(
      'insert into public.%1$I select * from jsonb_populate_recordset(null::public.%1$I, '
      || '(select coalesce(jsonb_agg(jsonb_set(x, ''{user_id}'', to_jsonb($2))), ''[]''::jsonb) '
      || 'from jsonb_array_elements($1) x))', nome)
      using p_backup->'tabelas'->nome, dono;
    get diagnostics qtd = row_count;
    total := total + qtd;
  end loop;
  return total;
end;
$$;

revoke all on function public.restaura_backup_integral(jsonb) from public, anon;
grant execute on function public.restaura_backup_integral(jsonb) to authenticated, service_role;

-- Conferência: restaurar dados fictícios numa conta vazia de um projeto de
-- teste; confirmar contagem, vínculos e recusa de segunda execução.
-- Rollback: drop function public.restaura_backup_integral(jsonb);
