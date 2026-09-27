-- Excluir a regra nao pode deixar cobrancas futuras no calendario.
-- O passado e qualquer movimento ja realizado continuam como historico.
create or replace function public.remove_ocorrencias_futuras_ao_excluir_assinatura()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  delete from public.transacoes
   where user_id = old.user_id
     and assinatura_id = old.id
     and status = 'prevista'
     and data >= current_date;
  return old;
end;
$$;

drop trigger if exists assinaturas_remove_ocorrencias_futuras on public.assinaturas;
create trigger assinaturas_remove_ocorrencias_futuras
before delete on public.assinaturas
for each row
execute function public.remove_ocorrencias_futuras_ao_excluir_assinatura();

revoke all on function public.remove_ocorrencias_futuras_ao_excluir_assinatura()
from public, anon, authenticated;

-- Corrige ocorrencias futuras que ja ficaram orfas antes deste gatilho.
delete from public.transacoes
 where assinatura_id is null
   and origem = 'recorrencia'
   and status = 'prevista'
   and data >= current_date;
