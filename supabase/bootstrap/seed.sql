-- =============================================================================
-- SEED · carga de exemplo, opcional, 100% inventada
-- =============================================================================
--
-- PARA QUE SERVE
--
-- Depois do `schema.sql`, um banco novo abre vazio -- e tela vazia não mostra
-- se a reconstrução deu certo. Esta carga põe uma instituição, duas contas,
-- uma árvore de categorias, um cartão com fatura, alguns compromissos e uma
-- meta, para a primeira tela ter o que desenhar.
--
-- É OPCIONAL. Se a ideia é começar do zero de verdade, pule este arquivo.
--
-- NADA AQUI É DE NINGUÉM
--
-- Todo nome é genérico, todo valor é redondo, toda data é de um mês fixo. Não
-- há saldo, credor, final de cartão ou identificador vindo de base em uso.
-- Este repositório é público: a carga de exemplo precisa continuar assim.
--
-- O DONO NÃO ESTÁ ESCRITO AQUI
--
-- O arquivo descobre o usuário lendo `auth.users`, e só aceita quando há
-- exatamente um. Com nenhum, avisa para criar a conta primeiro; com mais de
-- um, para dizer qual -- porque adivinhar o dono de dado financeiro é pior do
-- que parar.
--
-- COMO RODAR: crie sua conta no site, depois cole este arquivo no SQL Editor.
-- =============================================================================

do $$
declare
  dono uuid;
  quantos int;

  inst uuid := gen_random_uuid();
  corrente uuid := gen_random_uuid();
  carteira uuid := gen_random_uuid();
  cartao uuid := gen_random_uuid();
  credor uuid := gen_random_uuid();
  moradia uuid := gen_random_uuid();
  alimentacao uuid := gen_random_uuid();
  mercado uuid := gen_random_uuid();
  transporte uuid := gen_random_uuid();
  salario uuid := gen_random_uuid();
  fixa_luz uuid := gen_random_uuid();
  divida uuid := gen_random_uuid();
  meta uuid := gen_random_uuid();
  fatura uuid;
begin
  select count(*) into quantos from auth.users;
  if quantos = 0 then
    raise exception 'Não há nenhum usuário em auth.users. Crie sua conta no site primeiro, depois rode esta carga.';
  elsif quantos > 1 then
    raise exception 'Há % usuários em auth.users. Esta carga não adivinha o dono: troque `select id into dono` por um id explícito e rode de novo.', quantos;
  end if;
  select id into dono from auth.users;

  -- `fatura_na_competencia` recusa quem não está logado, e o SQL Editor roda
  -- sem JWT: `auth.uid()` sairia nulo e a carga pararia na fatura. Isto diz ao
  -- banco, só por esta transação, quem é o dono. É `true` no terceiro
  -- argumento -- local -- então some no fim, e não vaza para conexão nenhuma.
  perform set_config('request.jwt.claims', json_build_object('sub', dono)::text, true);

  if exists (select 1 from public.contas where user_id = dono) then
    raise exception 'Este usuário já tem conta cadastrada. A carga de exemplo é para banco vazio; rodar por cima misturaria exemplo com dado de verdade.';
  end if;

  insert into public.config (user_id, renda) values (dono, 5000.00);

  insert into public.instituicoes (id, user_id, nome, tipo, cor)
  values (inst, dono, 'Banco Exemplo', 'Banco', '#3366CC');

  insert into public.contas (id, user_id, instituicao_id, nome, tipo, saldo_inicial,
                             saldo_inicial_em, liquidez, ordem) values
    (corrente, dono, inst, 'Conta corrente', 'corrente', 3000.00, date_trunc('month', current_date)::date, 'livre', 1),
    (carteira, dono, null, 'Carteira',       'carteira',  200.00, date_trunc('month', current_date)::date, 'livre', 2);

  -- Duas raízes de saída, uma de entrada, e uma filha em Alimentação, para a
  -- tela de categorias nascer com os três níveis exercitados.
  insert into public.categorias (id, user_id, pai_id, nome, fluxo, cor, ordem) values
    (moradia,     dono, null,        'Moradia',     'saida',   '#8844AA', 1),
    (alimentacao, dono, null,        'Alimentação', 'saida',   '#22AA66', 2),
    (mercado,     dono, alimentacao, 'Mercado',     'saida',   '#22AA66', 1),
    (transporte,  dono, null,        'Transporte',  'saida',   '#CC7722', 3),
    (salario,     dono, null,        'Salário',     'entrada', '#2277CC', 1);

  insert into public.credores (id, user_id, nome, tipo)
  values (credor, dono, 'Credor Exemplo', 'Empresa');

  insert into public.cartoes (id, user_id, instituicao_id, nome, dia_fechamento,
                              dia_vencimento, limite, conta_padrao_id, cor)
  values (cartao, dono, inst, 'Cartão Exemplo', 10, 20, 4000.00, corrente, '#3366CC');

  -- A fatura sai da própria função do banco, e não de datas escritas à mão:
  -- assim ela nasce coerente com o fechamento do cartão, que é exatamente o
  -- que `testes/preview.mjs` cobra de qualquer cenário de exemplo.
  fatura := public.fatura_na_competencia(cartao, to_char(current_date, 'YYYY-MM'));

  insert into public.transacoes (user_id, conta_id, categoria_id, tipo, natureza,
                                 descricao, valor, data, status, origem) values
    (dono, corrente, salario,    'entrada','normal','Salário',            5000.00, date_trunc('month', current_date)::date,                        'realizada','manual'),
    (dono, corrente, moradia,    'saida',  'normal','Aluguel',            1200.00, (date_trunc('month', current_date) + interval '4 days')::date, 'realizada','manual'),
    (dono, corrente, mercado,    'saida',  'normal','Compra do mês',       450.00, (date_trunc('month', current_date) + interval '6 days')::date, 'realizada','manual'),
    (dono, carteira, transporte, 'saida',  'normal','Transporte',           60.00, (date_trunc('month', current_date) + interval '7 days')::date, 'realizada','manual');

  insert into public.transacoes (user_id, fatura_id, categoria_id, tipo, natureza,
                                 descricao, valor, data, status, origem) values
    (dono, fatura, mercado,    'saida','normal','Compra no cartão', 180.00, (date_trunc('month', current_date) + interval '3 days')::date, 'realizada','cartao'),
    (dono, fatura, transporte, 'saida','normal','Combustível',      120.00, (date_trunc('month', current_date) + interval '8 days')::date, 'realizada','cartao');

  insert into public.fixas (id, user_id, nome, valor, categoria, meio, credor_id, variavel, ordem)
  values (fixa_luz, dono, 'Energia', 150.00, 'Moradia', 'Debito automatico', credor, true, 1);

  insert into public.fixas_mes (user_id, fixa_id, mes, valor)
  values (dono, fixa_luz, to_char(current_date, 'YYYY-MM'), 168.00);

  insert into public.dividas (id, user_id, credor, descricao, categoria, valor,
                              parcela_inicial, total_parcelas, mes_inicial, credor_id, meio, ordem)
  values (divida, dono, 'Credor Exemplo', 'Parcelamento de exemplo', 'Terceiros',
          300.00, 1, 6, to_char(current_date, 'YYYY-MM'), credor, 'Boleto', 1);

  insert into public.receitas (user_id, descricao, categoria, valor, tipo, mes_inicial, ordem)
  values (dono, 'Salário', 'Fixa', 5000.00, 'mensal', to_char(current_date, 'YYYY-MM'), 1);

  insert into public.assinaturas (user_id, nome, valor, frequencia, categoria_id,
                                  conta_id, inicio, ordem)
  values (dono, 'Assinatura Exemplo', 30.00, 'mensal', alimentacao, corrente,
          date_trunc('month', current_date)::date, 1);

  -- Meta com uma reserva pequena de propósito: meta é envelope, não dinheiro
  -- novo, e uma reserva maior que o saldo livre seria recusada pelo gatilho no
  -- commit -- o que é o contrato funcionando, mas uma carga de exemplo que não
  -- entra não ajuda ninguém.
  insert into public.metas (id, user_id, nome, valor_alvo, prazo, prioridade, ordem)
  values (meta, dono, 'Reserva de emergência', 6000.00,
          (current_date + interval '12 months')::date, 1, 1);

  insert into public.alocacoes_de_meta (user_id, meta_id, valor, data, obs)
  values (dono, meta, 500.00, current_date, 'Reserva inicial de exemplo');

  raise notice 'Carga de exemplo aplicada: 2 contas, 5 categorias, 1 cartão com fatura, 6 lançamentos, 1 conta fixa, 1 dívida, 1 receita, 1 assinatura e 1 meta.';
end $$;
