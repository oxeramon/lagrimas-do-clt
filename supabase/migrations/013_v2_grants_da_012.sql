-- 013 · TIRA DE anon AS FUNÇÕES QUE A 012 CRIOU
--
-- O DEFEITO É MEU, DA 012. Ela terminava com `revoke all on function ... from
-- public`, que é o que as migrações anteriores faziam. Só que
-- `revoke ... from public` NÃO remove concessão explícita a um papel -- e o
-- Supabase tem `alter default privileges ... grant execute on functions to
-- anon, authenticated, service_role` no schema public. Toda função nova nasce
-- com anon=X EXPLÍCITO, e o revoke de PUBLIC passa ao largo dele.
--
-- Visível na ACL: paga_fatura já existia desde a 007 e ficou correta
-- (postgres=X | authenticated=X | service_role=X), enquanto as três funções
-- NOVAS da 012 saíram com anon=X no meio.
--
-- POR QUE NÃO VIROU VAZAMENTO: nenhuma é security definer, então rodam com o
-- privilégio de quem chama e o RLS continua valendo. anon somando transacoes
-- de uma fatura enxerga zero linhas e recebe 0,00. desfaz_pagamento_de_fatura
-- recusa com "é preciso estar logado".
--
-- POR QUE SE CONSERTA MESMO ASSIM: grants mínimos é regra do projeto, e
-- autorização nunca se apoia só num if dentro da função. Além disso, "hoje é
-- inofensivo" é propriedade do CORPO da função, e o corpo muda; o grant é que
-- precisa estar certo desde o começo.
--
-- confere_pagamento_de_fatura é função de GATILHO. Gatilho não precisa de
-- execute para ninguém: quem a executa é o próprio Postgres. Mesma correção
-- que a 002 fez nas funções de gatilho dela.

revoke execute on function public.total_devido_da_fatura(uuid) from anon;
revoke execute on function public.total_pago_da_fatura(uuid) from anon;
revoke execute on function public.desfaz_pagamento_de_fatura(uuid) from anon;

revoke all on function public.confere_pagamento_de_fatura() from public;
revoke all on function public.confere_pagamento_de_fatura() from anon;
revoke all on function public.confere_pagamento_de_fatura() from authenticated;
