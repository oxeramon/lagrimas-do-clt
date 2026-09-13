-- 013 · TIRA DE `anon` AS FUNÇÕES QUE A 012 CRIOU
--
-- O DEFEITO, e ele é meu, da 012.
--
-- A 012 terminava com `revoke all on function ... from public`, que é o que as
-- migrações anteriores faziam. Só que `revoke ... from public` NÃO remove uma
-- concessão explícita a um papel -- e o Supabase tem um
-- `alter default privileges ... grant execute on functions to anon, authenticated,
-- service_role` no schema `public`. Toda função nova nasce com `anon=X` EXPLÍCITO,
-- e o revoke de PUBLIC passa ao largo dele.
--
-- O resultado é visível na ACL: `paga_fatura` já existia desde a 007 e ficou
-- correta (`postgres=X | authenticated=X | service_role=X`), enquanto as três
-- funções NOVAS da 012 saíram com `anon=X` no meio.
--
-- POR QUE ISSO NÃO VIROU VAZAMENTO, e por que mesmo assim se conserta
--
-- Nenhuma das três é `security definer`: elas rodam com o privilégio de quem
-- chama, então o RLS continua valendo. `anon` somando `transacoes` de uma
-- fatura enxerga zero linhas e recebe 0,00 -- não há dado de ninguém do outro
-- lado. `desfaz_pagamento_de_fatura` recusa com "é preciso estar logado".
--
-- Conserta-se assim mesmo por duas razões. A primeira é a regra do projeto:
-- grants mínimos, e autorização nunca apoiada só num `if` dentro da função. A
-- segunda é que "hoje é inofensivo" é uma propriedade do corpo da função, e o
-- corpo muda; o grant é que precisa estar certo desde o começo.
--
-- `confere_pagamento_de_fatura` é função de GATILHO. Gatilho não precisa de
-- `execute` para ninguém -- quem a executa é o próprio Postgres, no contexto do
-- gatilho. Foi a mesma correção que a 002 fez nas funções de gatilho dela.

begin;

revoke execute on function public.total_devido_da_fatura(uuid) from anon;
revoke execute on function public.total_pago_da_fatura(uuid) from anon;
revoke execute on function public.desfaz_pagamento_de_fatura(uuid) from anon;

-- Gatilho sai da API inteira: sem PUBLIC, sem anon, sem authenticated. Ela
-- aparecia em /rest/v1/rpc/ e não tem por que aparecer.
revoke all on function public.confere_pagamento_de_fatura() from public;
revoke all on function public.confere_pagamento_de_fatura() from anon;
revoke all on function public.confere_pagamento_de_fatura() from authenticated;

commit;
