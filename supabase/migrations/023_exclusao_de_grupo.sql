-- Um grupo apaga em cascata membros, despesas, rateios e acertos.
-- RESTRICT confere os membros antes de as outras cascatas terminarem.
-- NO ACTION diferido preserva a protecao contra apagar um membro isolado,
-- mas permite que todas as linhas do grupo desaparecam na mesma transacao.

alter table public.despesas_do_grupo
  drop constraint despesas_pagador_dono_fk,
  add constraint despesas_pagador_dono_fk
    foreign key (user_id, pago_por_id) references public.membros (user_id, id)
    on update cascade on delete no action deferrable initially deferred;

alter table public.rateios
  drop constraint rateios_membro_dono_fk,
  add constraint rateios_membro_dono_fk
    foreign key (user_id, membro_id) references public.membros (user_id, id)
    on update cascade on delete no action deferrable initially deferred;

alter table public.acertos
  drop constraint acertos_de_dono_fk,
  add constraint acertos_de_dono_fk
    foreign key (user_id, de_id) references public.membros (user_id, id)
    on update cascade on delete no action deferrable initially deferred,
  drop constraint acertos_para_dono_fk,
  add constraint acertos_para_dono_fk
    foreign key (user_id, para_id) references public.membros (user_id, id)
    on update cascade on delete no action deferrable initially deferred;

