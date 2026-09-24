-- Ao excluir uma assinatura, a FK desvincula as transacoes geradas.
-- A data da ocorrencia identifica apenas a cobranca recorrente; ela deve
-- ser limpa junto com assinatura_id para manter ocorrencia_tem_data valida.
-- Os demais dados da transacao, inclusive data, valor e status, permanecem.
create or replace function public.limpa_ocorrencia_ao_desvincular_assinatura()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.assinatura_id is not null and new.assinatura_id is null then
    new.ocorrencia_em := null;
  end if;
  return new;
end;
$$;

drop trigger if exists transacoes_limpa_ocorrencia_ao_desvincular on public.transacoes;
create trigger transacoes_limpa_ocorrencia_ao_desvincular
before update of assinatura_id on public.transacoes
for each row
execute function public.limpa_ocorrencia_ao_desvincular_assinatura();

revoke all on function public.limpa_ocorrencia_ao_desvincular_assinatura() from public, anon, authenticated;

