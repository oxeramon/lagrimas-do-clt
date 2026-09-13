# Migrações aplicadas

O que já rodou no banco, quando, e como foi conferido. Uma linha por migração,
em ordem. Este arquivo é o registro; o SQL é a fonte.

| Versão | Arquivo | Quando | Situação |
|---|---|---|---|
| — | `../supabase-setup.sql` | antes do registro existir | aplicada colando no SQL Editor, fora do controle de migrações |
| `20260912185920` | `../supabase/migrations/001_v2_foundation.sql` | 12/09/2026 | **aplicada** · imutável |
| `20260912192729` | `../supabase/migrations/002_v2_integrity_hardening.sql` | 12/09/2026 | **aplicada** |
| `20260912193340` | `../supabase/migrations/003_v2_search_path_das_funcoes.sql` | 12/09/2026 | **aplicada** |
| `20260912200722` | `../supabase/migrations/004_v2_transaction_operations.sql` | 12/09/2026 | **aplicada** |
| `20260912214852` | `../supabase/migrations/005_v2_settlement_bridge.sql` | 12/09/2026 | **aplicada** |
| `20260912214949` | `../supabase/migrations/006_v2_trigger_grants.sql` | 12/09/2026 | **aplicada** |
| `20260912230851` | `../supabase/migrations/007_v2_cartoes_e_faturas.sql` | 12/09/2026 | **aplicada** |
| `20260912233655` | `../supabase/migrations/008_v2_assinaturas.sql` | 12/09/2026 | **aplicada** |
| `20260912235737` | `../supabase/migrations/009_v2_grupos_e_rateios.sql` | 12/09/2026 | **aplicada** |
| `20260913000402` | `../supabase/migrations/010_v2_estorno.sql` | 13/09/2026 | **aplicada** |
| `20260913163027` | `../supabase/migrations/011_v2_assinatura_semanal.sql` | 13/09/2026 | **aplicada** |
| `20260913163609` | `../supabase/migrations/012_v2_fatura_parcial.sql` | 13/09/2026 | **aplicada** |
| `20260913163724` | `../supabase/migrations/013_v2_grants_da_012.sql` | 13/09/2026 | **aplicada** · conserta o grant da 012 |
| `20260913172346` | `../supabase/migrations/014_v2_metas.sql` | 13/09/2026 | **aplicada** |
| `20260913222813` | `../supabase/migrations/015_v2_ownership_hardening.sql` | 13/09/2026 | **aplicada** |

**Migração aplicada não se edita.** Quando o arquivo e o banco discordam, some
a única fonte confiável sobre o que rodou. Conserto vira migração nova, e é por
isso que existe uma 003 de duas linhas em vez de um remendo na 002.

## Por que a V1 não aparece no histórico

`list_migrations` estava vazio até a 001. A V1 entrou colada inteira no SQL
Editor, e o SQL Editor não escreve em `supabase_migrations.schema_migrations`.
A consequência prática: **o histórico registrado começa na 001**, e não contém
a linha de base da V1.

Isso não é um defeito a corrigir agora, mas é preciso saber ao ler o histórico:
**um banco novo não se reconstrói aplicando as migrações registradas**, porque
falta a linha de base. Por isso a instalação do zero deixou de ser "cole o
arquivo da V1 e depois as migrações": ela é `supabase/bootstrap/schema.sql`, que
já nasce com tudo, e o `supabase/bootstrap/README.md` descreve.

## 001 · fundação da V2

Acrescenta `instituicoes`, `contas`, `categorias` e `transacoes`, mais a view
`saldos_de_conta`, a função `nivel_da_categoria()` e o gatilho que a usa.
Puramente aditiva: não renomeia, não remove, não migra dado e não toca em
nenhuma tabela da V1.

Conferido depois de rodar: as quatro tabelas com `rowsecurity` ligada, a view
com `security_invoker`, uma policy por tabela com `using` **e** `with check` por
`auth.uid()`, os gatilhos `*_set_user`, 17 índices, 9 chaves estrangeiras, 14
`check`, zero linha nas tabelas novas, as oito tabelas da V1 com contagem
idêntica à de antes, e `set_user_id()` preservada.

### O cabeçalho da 001 está desatualizado, de propósito

A primeira linha do arquivo diz que a migração ainda não foi executada. Ela
ficou como estava para o arquivo continuar idêntico ao texto gravado em
`schema_migrations`. Quem for ler o SQL deve olhar a tabela no topo **deste**
arquivo para saber o que já rodou.

## 002 · integridade da V2

Rodou com as quatro tabelas ainda vazias, que era a pré-condição: ela estreita
o modelo, e com dado dentro teria cortado linha. Conserta seis defeitos que a
001 deixou passar.

| # | O defeito | O conserto |
|---|---|---|
| 1 | FK apontava só para `id`, então uma linha podia referenciar objeto de outro usuário — a checagem de FK roda por fora do RLS | `unique (user_id, id)` nas tabelas apontadas e FK composta `(user_id, coluna)` em todas as cinco relações |
| 2 | transferência não tinha sinal: `valor >= 0`, `tipo = 'transferencia'` e a view somando `+valor` nas duas pernas | `tipo` passa a ser só `entrada`/`saida`; `natureza` guarda `normal`/`transferencia`/`estorno` |
| 3 | `transferencia_tem_par` não obrigava par nenhum, e o par era FK circular para a própria tabela | `transferencia_id` comum às duas pernas, com gatilho de constraint **diferido** conferindo o grupo no commit |
| 4 | estorno somava sempre como entrada | estorno é uma linha de sinal contrário ligada à original por `estorno_de_id` |
| 5 | `unique (user_id, pai_id, nome)` não barrava duas raízes com o mesmo nome, porque NULL nunca é igual a NULL | `unique nulls not distinct` |
| 6 | `categorias_nivel` disparava **antes** de `categorias_set_user` (ordem alfabética), e o nível saía calculado com `user_id` nulo | `categorias_1_set_user` e `categorias_2_nivel`, com a ordem no nome |

### A regra de saldo, agora sem caso especial

```
saldo = saldo_inicial + entradas realizadas − saídas realizadas
```

Transferência não aparece nessa conta, e é esse o ponto: as duas pernas já são
uma `saida` e uma `entrada` comuns. A conta de origem diminui, a de destino
aumenta, e somando todas as contas o patrimônio não se mexe.

### Contrato de categoria, explícito

O nome é único entre irmãos, e as raízes são irmãs entre si. Vale por usuário e
**não** olha `fluxo`: não dá para ter "Ajuste" como raiz de entrada e outra de
saída. É escolha, não acidente — nome repetido em duas árvores confunde na hora
de escolher numa lista.

### Como foi provado

`supabase/testes/002_integridade.sql`, **27 casos**, rodando no banco de
verdade dentro de uma transação que termina em `rollback`. Dois usuários
inventados na hora, nenhum identificador real.

| O que prova | Casos |
|---|---|
| entrada aumenta, saída reduz | 1 |
| transferência move entre contas e não cria patrimônio | 2, 3, 4 |
| estorno de saída aumenta; estorno de entrada reduz | 5, 6 |
| prevista e cancelada ficam fora do saldo | 7 |
| conta, categoria, pai e original de outro usuário são recusados pela FK | 8, 9, 10, 11, 12 |
| transferência pela metade, com valores diferentes ou na mesma conta é recusada | 13, 14, 15 |
| `natureza = transferencia` exige grupo; `tipo = transferencia` não existe mais | 16, 17 |
| raiz duplicada recusada; níveis 1, 2 e 3; quarto nível recusado; mesmo nome sob pais diferentes permitido | 18, 19, 20, 21 |
| nível correto quando o `user_id` vem do gatilho — a regressão do defeito 6 | 22 |
| RLS: o logado só vê o que é dele, `anon` não vê nada da V2 nem da V1 | 23, 24, 26, 27 |
| insert continua funcionando depois do `revoke execute` | 25 |

Uma armadilha que o arquivo contorna: o gatilho da transferência é **diferido**,
então só dispararia no commit — que nunca chega, porque o teste termina em
rollback. `set constraints all immediate` força a conferência na hora.

### Rollback

Não há, e é melhor dizer isso do que fingir que há. A 002 estreita o modelo:
`transferencia_par_id` deixou de existir e `tipo` deixou de aceitar
`transferencia` e `estorno`. Voltar seria recriar o modelo defeituoso. Desfazer
só faz sentido derrubando a V2 inteira, pelo bloco no fim da 001, e só enquanto
as quatro contagens estiverem em zero.

## 003 · search_path fixo nas funções da transferência

Duas linhas. `valida_transferencia()` e `confere_grupo_transferencia()`
nasceram na 002 sem `search_path` fixo. As duas já qualificavam tudo por
extenso, então não havia furo de verdade, mas o linter aponta o padrão e a
razão dele é boa.

Depois dela, **as quatro funções de gatilho estão com `search_path = public` e
sem `execute` para `anon` nem `authenticated`**.

## 004 · operações atômicas de transferência

A 002 deixou o modelo certo, mas o frontend não tinha como cumpri-lo. Duas
pernas por dois `insert` HTTP são duas transações: a primeira comita, a segunda
falha, e sobra meia transferência ou a dúvida de se sobrou. A 004 leva as duas
pernas para dentro do Postgres.

| Função | O que faz |
|---|---|
| `cria_transferencia` | os dois inserts num comando só; devolve o `transferencia_id` |
| `atualiza_transferencia` | as duas pernas na mesma transação; trocar os parâmetros inverte o sentido |
| `remove_transferencia` | apaga o grupo inteiro, nunca uma perna |
| `confere_pernas_da_transferencia` | a validação que as três compartilham |

Todas `SECURITY INVOKER`, com `search_path` fixo, sem `execute` para `anon` e
com `execute` para `authenticated`. **Nenhuma aceita `user_id`**: quem preenche
é o gatilho, com `auth.uid()`. A conferência de dono não pergunta "essa conta é
minha?" -- ela conta quantas das duas o RLS deixa enxergar, porque distinguir
"não é sua" de "não existe" contaria que o id existe.

### O defeito da 002 que ela conserta

A 002 revogou `execute` de `confere_grupo_transferencia()` junto com o das
outras funções de gatilho. O raciocínio estava certo pela metade: **gatilho não
precisa de `execute`, mas função CHAMADA por um gatilho precisa.**
`valida_transferencia()` a chamava com `perform`, e toda transferência de
usuário real morria com `permission denied`. Ninguém tinha esbarrado porque a
V2 está vazia.

O conserto tira a chamada do meio em vez de devolver o grant: a conferência
passou a morar dentro do próprio gatilho, e a função antiga saiu.

**Por que escapou, e a lição:** os testes da 002 rodavam como `postgres`, que é
dono das tabelas e passa por cima de RLS e de grant. Teste de permissão que
roda como dono não prova nada. Pelo mesmo motivo, as ajudantes dos dois
arquivos de teste deixaram de ser `security definer` -- com elas assim, um caso
de "anon não pode" passava sozinho.

### Como foi provada

`supabase/testes/004_operacoes.sql`, **25 casos**, rodando como `authenticated`
e como `anon`, em transação com `rollback`. Cobre o caminho feliz, a
atomicidade (um `status` inválido derruba a operação inteira sem deixar perna
órfã), as recusas (mesma conta, valor zero, conta alheia, grupo inexistente), a
edição, a exclusão do par, o gatilho rodando para usuário de verdade, e `anon`
esbarrando no grant.

## 005 · a ponte entre compromisso e movimento

O contrato foi escrito antes do SQL, e está em [`CONTRATO_PONTE.md`](CONTRATO_PONTE.md).
O problema cabe numa frase: **uma obrigação não é uma movimentação.** "Eu devo
500" e "500 saíram da conta X em 12/09" podem se relacionar, não são a mesma
entidade, e somá-las conta o mesmo dinheiro duas vezes.

A decisão: uma tabela de vínculo, `liquidacoes`, e não só `origem`/`origem_id`.
As duas colunas existem e continuam preenchidas, para filtrar sem `join`, mas
não bastam como identidade: **um compromisso da V1 não é uma linha, é uma linha
vezes um mês.** Uma dívida de 24 parcelas é uma linha em `dividas` e vinte e
quatro obrigações distintas, e `origem_id = <uuid>` não diz qual parcela foi
paga. `liquidacoes` carrega a competência como coluna.

`item_id` é texto com a MESMA convenção de `pagamentos` da V1 — `<uuid>` para
dívida, `fx:<uuid>` para conta fixa. É isso que faz a marca da V1 e o vínculo
da V2 falarem do mesmo item sem tradução. O preço é o banco não conseguir
garantir que o `item_id` existe; quem garante é a RPC, lendo com o RLS ligado.

### A lacuna da V1 que ela resolve

`receitas` nunca teve marcador de recebimento: `pagamentos` só existe para
saídas. Em vez de uma tabela `recebimentos` paralela, ou de enfiar recebimento
numa tabela chamada `pagamentos`, **a existência da linha em `liquidacoes` É o
marcador.**

### O que entrou

| Objeto | O que faz |
|---|---|
| `liquidacoes` | RLS ligada, policy por `auth.uid()`, gatilho `set_user_id`, três índices |
| `liquidacao_uma_por_competencia` | `unique (user_id, tipo, item_id, competencia)` — pagar duas vezes o mesmo mês é recusado pelo BANCO |
| `liquidacao_uma_por_transacao` | `unique (user_id, transacao_id)` — uma transação liquida no máximo um compromisso |
| FK composta | `(user_id, transacao_id) → transacoes (user_id, id)`, `on delete cascade` — a mesma escolha da 002: FK não passa por RLS |
| `limpa_marca_da_liquidacao()` | `after delete` — apagar a transação leva o vínculo pelo cascade, e o gatilho leva a marca da V1 junto |
| `confere_liquidacao` | a conferência que as três operações compartilham |
| `liquida_compromisso` | saída + marca da V1 + vínculo, numa transação |
| `recebe_receita` | entrada + vínculo. Sem marca: receita não é pagamento |
| `desfaz_liquidacao` | apaga a transação; o resto vem junto |

Todas as funções são `SECURITY INVOKER`, com `search_path = public`, sem
parâmetro de `user_id` (quem preenche é o gatilho, com `auth.uid()`), revogadas
de `public` e `anon` e concedidas só a `authenticated`.

O `check` de `transacoes.origem` foi alargado para aceitar `'fixa'` e
`'receita'`, que faltavam.

### Pré-condição diferente das anteriores

Da 001 à 004, as tabelas da V2 estavam vazias. Na 005 já não estavam: havia
contas e categorias cadastradas por gente de verdade. Por isso ela é
**estritamente aditiva** — cria uma tabela, alarga um `check` numa tabela sem
linhas, e não toca em mais nada.

### Liquidação parcial ficou de fora, de propósito

A `unique` por competência exclui pagamento e recebimento parciais. A V1 não
tem onde guardar "quanto ainda falta desta parcela": o compromisso tem um valor
só e `pagamentos` é booleano. Suportar parcial exigiria mudar o significado de
um dado que já existe, e isso é bem mais caro do que adiar. O caminho, quando
for a hora, está escrito no contrato.

### Como foi provada

`supabase/testes/005_ponte.sql`, **34 casos**, rodando como `authenticated` e
como `anon`, em transação com `rollback`, com dois usuários sintéticos criados
ali dentro. Última execução no banco real: **34 de 34**, sem resíduo.

Cobre os dois casos do contrato anti-dupla-contagem que passam pelo banco
(dívida de 500 paga por saída de 500 = 500, e receita de 1.000 recebida uma vez
= 1.000), a atomicidade das três escritas, a recusa da segunda liquidação da
mesma competência, o desfazer levando os três lados, o `cascade` e o gatilho, a
marca feita à mão continuando válida sozinha, compromisso e conta de outro
usuário recusados, e `anon` esbarrando no grant das duas RPCs.

## 006 · o gatilho que anon não devia poder chamar

Duas linhas. `limpa_marca_da_liquidacao()` nasceu na 005 chamável por `anon` e
por `authenticated` — sozinha ela não apaga nada sem uma linha em
`liquidacoes`, mas função de gatilho não é API, e a 002 já tinha estabelecido a
regra. Migração aplicada não se edita, nem quando o conserto tem duas linhas.

## 007 · cartões e faturas

Contrato escrito antes do SQL, em [`CONTRATO_CARTAO.md`](CONTRATO_CARTAO.md).
Ele cabe em duas frases:

> **Compra no cartão é despesa.**
> **Pagamento da fatura não é despesa nova.**

### A assimetria que torna a dupla contagem inescrevível

```
compra no cartão      fatura_id preenchido, conta_id VAZIO
pagamento da fatura   conta_id preenchido,  fatura_id VAZIO
```

Duas perguntas, dois filtros que nunca se cruzam:

| Pergunta | Filtro |
|---|---|
| quanto eu gastei (consumo) | `tipo='saida'` e `natureza='normal'` |
| quanto saiu da conta (caixa) | `conta_id is not null` |

Compra de 100 mais pagamento de 100 dá 100 de consumo e 100 de caixa. Nunca
200 em lugar nenhum. Três `check` garantem: `transacao_nao_e_conta_e_fatura`,
`pagamento_de_fatura_sai_de_conta` e `parcela_mora_numa_fatura`.

### O que entrou

| Objeto | O que faz |
|---|---|
| `cartoes` | nome, apelido, **final de quatro dígitos opcional**, limite, ciclo, conta padrão, cor. Nunca número completo, CVV, validade, senha ou token |
| `faturas` | cartão, competência e as três datas do ciclo. `unique (user_id, cartao_id, competencia)` |
| `compras_de_cartao` | a compra lógica: uma decisão, N obrigações |
| `transacoes` + `fatura_id`, `compra_id`, `parcela`, `total_parcelas` | parcela com identidade de coluna, não de sufixo de texto |
| `dia_no_mes`, `competencia_da_compra`, `ciclo_da_fatura` | a regra do ciclo, implementada uma vez |
| `faturas_resolvidas` | view `security_invoker` com total, pago e situação **derivados** |
| `fatura_na_competencia`, `fatura_do_cartao` | a fatura nasce sob demanda, idempotente pelo `unique` |
| `registra_compra_de_cartao` | compra e N parcelas numa transação; centavos com sobra na primeira |
| `paga_fatura` | saída com `natureza='pagamento_de_fatura'` + vínculo em `liquidacoes` |

`natureza` ganhou `'pagamento_de_fatura'` e `liquidacoes.tipo` ganhou
`'fatura'` — este último era o caso que o contrato da ponte previa com o texto
"só precisa entrar no check".

### A regra do ciclo, e por que ela fica no banco

```
fechamento(M) = dia min(F, último dia de M) do mês M
abertura(M)   = fechamento(M-1)
vencimento(M) = dia min(V, último dia de Mv) do mês Mv, Mv = M se V > F, senão M+1

competência(D) = mês(D) se dia(D) < fechamento-dia(mês(D)), senão mês(D)+1
```

Janela meio aberta: `abertura <= D < fechamento`. Compra no PRÓPRIO dia do
fechamento cai na fatura seguinte — é a mesma regra que a V1 já usa em
`js/domain/billing.js`, e discordar dela faria as duas metades do app falarem
coisas diferentes da mesma compra.

O dia guardado no cartão não é truncado; quem trunca é o cálculo, mês a mês.

### Total derivado, não guardado

`faturas` não tem coluna de total nem de status. Guardar o total criaria dois
números com o mesmo nome, e eles discordariam no primeiro estorno. A
consequência boa aparece no teste 52: apagar o pagamento devolve a fatura para
"fechada" **sozinho**, sem gatilho nenhum, porque a situação é derivada.

### Como foi provada

`supabase/testes/007_cartoes.sql`, **67 casos**, como `authenticated` e como
`anon`, em transação com `rollback`.

**Ela foi rodada inteira ANTES de ser aplicada**: o DDL e os 67 casos foram
executados juntos numa transação revertida no fim. Esse ensaio encontrou um
defeito real — uma variável chamada `nome` dentro de `paga_fatura` colidia com
a coluna `nome` de `cartoes`, e o plpgsql só recusa essa ambiguidade em tempo
de EXECUÇÃO. O erro apareceria na primeira fatura paga de verdade. Depois de
aplicada, os 67 rodaram de novo contra o schema aplicado: 67 de 67, sem
resíduo.

Cobrem o truncamento de dia (fevereiro comum, bissexto, mês de 30 dias), a
fronteira do fechamento nos três lados, a virada de dezembro, as três datas do
ciclo, a recusa de guardar mais que quatro dígitos, a idempotência da criação
da fatura, os centavos do parcelamento, o CASO A completo, o desfazer, as
recusas de conta e cartão alheios, e `anon` esbarrando no grant das três RPCs.

## 008 · assinaturas e recorrência

A distinção que organiza a migração inteira:

> **Assinatura é REGRA.** "R$ 19,90 todo mês, desde março."
> **Ocorrência é EVENTO.** "R$ 19,90 saíram em 05/09."

Confundir as duas é o mesmo erro que a ponte resolveu do outro lado: somar a
regra com o evento conta o mesmo dinheiro duas vezes.

### A estratégia de materialização

Uma assinatura mensal sem data de fim tem infinitas ocorrências. Gerar "todas"
é impossível, e gerar duzentas por garantia enche o banco de linhas que
ninguém vai olhar e que precisam ser apagadas quando o valor mudar.

**Materializa-se sob demanda, numa janela curta de dois meses, e a
idempotência é do BANCO.** `unique (user_id, assinatura_id, competencia)`
garante que rodar a geração duas vezes não duplica nada — e é essa propriedade,
e só ela, que torna seguro chamá-la a cada carga da tela.

É a mesma ideia da fatura na 007: encontrar ou criar, com o `unique` fazendo o
trabalho. Duas features, um mecanismo.

### A ocorrência não é tabela nova

Ela **é** uma transação, com `status='prevista'`. O que faltava era reconhecer
"esta é a cobrança de setembro desta assinatura", e a resposta é a mesma da
ponte: competência como coluna. `transacoes` ganhou `assinatura_id` e
`competencia`.

Previsto não entra em saldo nem em consumo — a 001 já tinha decidido isso, e
nada aqui mudou. Confirmar uma cobrança é mudar o status, e aí sim ela vira
dinheiro.

### Assinatura no cartão cai na fatura

Quando a assinatura é paga no cartão, a ocorrência nasce dentro da fatura do
ciclo daquela data, criada sob demanda pela própria geração. Ela é prevista,
então não engorda o total da fatura até acontecer.

`conta_id` e `cartao_id` são mutuamente exclusivos, e **os dois podem faltar**:
"ainda não decidi por onde pago" é um estado real, e forçar uma escolha falsa
só produziria dado errado.

### Frequência semanal: cadastra, não materializa

A competência por mês não distingue quatro cobranças semanais do mesmo mês, e a
`unique` deixaria passar só a primeira. Resolver direito exige mudar a chave.
Até lá, assinatura semanal é cadastrada, entra no custo equivalente (52 semanas
por ano) e **não** vira ocorrência. A exclusão está declarada no código e na
tela.

### O que a view deriva

Custo mensal equivalente e custo anual equivalente — para comparar uma
assinatura anual com uma mensal sem conta de cabeça — e a próxima cobrança,
que sai da âncora `inicio` em vez de ser guardada. Derivado guardado envelhece.

### Como foi provada

`supabase/testes/008_assinaturas.sql`, **35 casos**, como `authenticated` e como
`anon`, em transação com `rollback`. Rodados ANTES da aplicação, junto com o
próprio DDL numa transação revertida: 35 de 35 no ensaio e 35 de 35 depois.

O caso 9 é o que mais importa: a segunda geração cria zero. Se ele quebrar,
chamar a geração a cada carga da tela encheria o banco de duplicatas.

## 009 · grupos, rateios e acertos

A mesma ideia das anteriores, vista de mais um ângulo:

> **GRUPO calcula OBRIGAÇÃO.** "Carlos te deve R$ 100."
> **TRANSAÇÃO calcula DINHEIRO.** "Carlos pagou R$ 100 na sua conta."

Registrar um acerto no grupo não move dinheiro nenhum. Quem liga as duas
metades é a pessoa, escolhendo a conta — nunca o app por conta própria.
Adivinhar aqui é a maneira mais rápida de inventar uma entrada que não existiu.

### Minimização de dados

Membro de grupo **não é usuário do app** e não precisa ser. A tabela guarda
nome, apelido e nada mais. Sem e-mail, sem telefone, sem documento — não porque
seja difícil, mas porque não é necessário, e dado pessoal que não existe não
vaza. O caso 3 dos testes cobra isso consultando o `information_schema`: se
alguém acrescentar uma dessas colunas, o teste acusa.

### O contrato dos centavos, cobrado pelo banco

A soma dos rateios é **exatamente** o valor da despesa. Não "aproximadamente".
Dois gatilhos postergados cobram isso — um do lado do rateio, outro do lado da
despesa — e eles são `deferrable initially deferred` porque os rateios entram
um a um: conferir a cada linha recusaria a primeira. É a mesma técnica que a
002 usa para as duas pernas de uma transferência.

Estar no banco e não na RPC importa: **nem a RPC consegue contornar.** Quem
escrever direto na tabela esbarra na mesma regra.

Despesa sem rateio nenhum também é pega: a soma de zero linhas é zero, e zero é
diferente do valor da despesa.

### O saldo, e a prova de que a conta fecha

```
saldo = pagou − coube − recebeu de acerto + quitou de acerto
```

Positivo tem a receber, negativo deve. E **a soma dos saldos de um grupo é
sempre zero** — é assim que se sabe que a conta fecha, e é um caso de teste.

### `sou_eu`

Um membro por grupo pode ser marcado como a própria pessoa, garantido por
índice parcial único. Sem isso o app só saberia dizer "A deve a B", que não
ajuda ninguém a decidir nada. Zero também é válido: dá para acompanhar o rateio
de outras pessoas.

É `sou_eu` que decide o sinal quando um acerto entra em conta — entrada quando o
dinheiro vem para você, saída quando sai. Acerto entre duas outras pessoas não
entra na sua conta, e a RPC recusa.

### Como foi provada

`supabase/testes/009_grupos.sql`, **35 casos**, como `authenticated` e como
`anon`, em transação com `rollback`. Rodados antes da aplicação junto com o
DDL, e de novo depois: 35 de 35 nas duas vezes.

O `deve_falhar` deste arquivo é diferente dos outros: ele chama `set
constraints all immediate` antes de julgar, porque gatilho postergado só
dispara no commit — e este arquivo nunca faz commit.

## 010 · estorno

O schema tinha `natureza='estorno'` e `estorno_de_id` desde a 002, e a
interface nunca teve botão. O que faltava não era coluna: era **decisão**. O
contrato está em [`CONTRATO_ESTORNO.md`](CONTRATO_ESTORNO.md), com as onze
perguntas respondidas uma a uma.

### A regra que decide tudo

> Transação que carrega **vínculo estrutural** não se estorna, se desfaz.

Estorno é para dinheiro que voltou; desfazer é para registro que não devia
existir. Daí saem os três "não" — transferência, pagamento de fatura e
liquidação da V1 — e nenhum deles é preguiça: estornar uma perna de
transferência deixaria o par quebrado, e estornar um pagamento de fatura
deixaria a fatura "paga" com o dinheiro de volta no bolso. Dois estados
verdadeiros e incompatíveis.

### O que o banco garante

Sinal invertido, soma dos estornos nunca maior que o original (gatilho
postergado, como o rateio da 009), só transação de natureza `normal`, sem
vínculo em `liquidacoes`, e nada de estorno de estorno.

### O defeito que o contrato revelou

`estorna_transacao` herda `fatura_id` do original, e isso está certo: estorno
de compra no cartão volta **para a fatura**, que é o que o cartão faz. Mas a
soma da 007 era `sum(t.valor)`, sem olhar o tipo — uma compra de 100 com
estorno de 100 daria uma fatura de **200**.

Enquanto não havia estorno, nenhuma linha de fatura era entrada e a soma sem
sinal dava o mesmo resultado. A 010 substitui a view por uma com sinal.

### E a mudança que quase passou batido, do lado do JavaScript

O saldo da conta fecha sozinho. **"Quanto eu gastei" não.** O filtro de consumo
pede `natureza='normal'`, e o estorno tem natureza `estorno`: o dinheiro voltava
e o relatório continuava dizendo que a pessoa gastou.

As somas viraram líquidas, e **cada estorno desconta do lado do seu original**,
nunca soma do outro — contá-lo nos dois lados descontaria o mesmo evento duas
vezes e erraria o resultado do mês.

### Como foi provada

`supabase/testes/010_estorno.sql`, **25 casos**, rodados antes e depois da
aplicação: 25 de 25 depois. O ensaio pré-aplicação acusou uma falha, e ela era
do TESTE — uma constante de saldo calculada errada por mim, não um defeito do
código.

Mais 13 casos em `testes/regras.mjs` para o netting, com três mutações
derrubadas.

### Sem botão, ainda

A mudança do cálculo precisava provar-se em número antes de virar interface.
Expor a ação é o passo seguinte e não depende de mais nenhuma decisão.

## 011 · assinatura semanal

### O defeito, e por que ele era de modelo e não de código

A 008 identificava uma ocorrência por `(user_id, assinatura_id, competencia)`,
e `competencia` é `YYYY-MM`. Quatro ou cinco cobranças semanais no mesmo mês
não cabem nessa chave: a segunda colide com a primeira.

A 008 percebeu e **desviou em vez de modelar errado**, o que foi a decisão
certa na hora: `materializa_assinaturas` filtrava `frequencia <> 'semanal'` e
`competencia_da_ocorrencia` devolvia `null` para semanal — que o CHECK
`ocorrencia_tem_competencia` recusava. O efeito visível era estranho: dava para
**cadastrar** uma assinatura semanal, e ela nunca virava cobrança nenhuma.

### A correção

A identidade da ocorrência passa a ser a **data** em que ela acontece:
`unique (user_id, assinatura_id, ocorrencia_em)`. Mês é recorte de relatório; a
cobrança é um evento com data. Para mensal nada muda na prática, porque duas
ocorrências mensais nunca caem no mesmo dia.

`competencia` continua preenchida, inclusive para semanal, porque é por ela que
o resto do produto agrupa. Ela só deixa de **identificar**.

### A ordem da migração não é estilo, é obrigação

O ensaio em transação revertida encontrou um defeito que teria abortado a
migração no meio, em produção:

```
55006: cannot ALTER TABLE "transacoes" because it has pending trigger events
```

A 002 criou um gatilho de constraint **diferido** para o par da transferência.
O `update` do backfill enfileira eventos desse gatilho, e o Postgres recusa
qualquer `alter table` enquanto houver evento pendente. A migração teria parado
com a coluna criada e as constraints antigas já removidas — o pior estado
possível.

O conserto é uma linha, `set constraints all immediate`, entre o backfill e as
constraints novas. Nenhum teste de JavaScript encontraria isso; quem encontrou
foi o ensaio contra o banco de verdade.

### A janela continua curta

Dois meses, como na 008. Semanal dá cerca de nove ocorrências nesse intervalo —
"o que vem por aí" sem encher o banco de linha que ninguém vai olhar. O teto de
voltas do laço subiu de 2.000 para 5.000 porque semanal gasta 52 voltas por ano
de atraso, e uma assinatura antiga esgotaria o teto anterior.

### Como foi provada

`supabase/testes/011_semanal.sql`, 27 casos, `authenticated` e `anon` reais.
Cinco ocorrências em 28 dias; quatro num mês e cinco em outro; competência que
**repete de propósito**; a mesma data duas vezes recusada pelo banco;
idempotência (segunda chamada cria zero) e janela ampliada criando **só** o que
faltava; virada de ano, fevereiro comum e 29/02 de ano bissexto. Datas são
`date`, sem hora e sem fuso, então horário de verão não tem por onde entrar.

Duas falhas do primeiro ensaio eram do **teste**, não da migração: eu cadastrava
assinaturas novas entre a primeira e a segunda materialização, então a segunda
tinha trabalho legítimo a fazer. A prova de idempotência foi reordenada para
medir o que afirma.

## 012 a 014

Pagamento parcial de fatura (012), o grant que a 012 esqueceu (013) e metas
(014). O que cada uma fez está no cabeçalho do próprio arquivo, e as suítes
correspondentes estão em `../supabase/testes/`.

## 015 · ownership na V1, e metas ligadas a auth.users

Duas correções de integridade, as duas achadas pela rodada de reconstrução do
banco, nenhuma delas visível pela tela.

**`metas` e `alocacoes_de_meta` não tinham FK para `auth.users`.** As outras
vinte e duas tabelas com dono tinham, com cascade. Apagar a conta no Auth
levava junto tudo menos essas duas, que ficavam com um `user_id` que não
existe mais: invisíveis para o RLS, porque nenhum `auth.uid()` bate, e sem
caminho de volta.

**Cinco FKs da V1 apontavam só por `id`:** `dividas.credor_id`,
`dividas.pessoa_id`, `fixas.credor_id`, `credores.credor_pai_id` e
`fixas_mes.fixa_id`. É o mesmo defeito que a 002 consertou na V2, e a mesma
razão: a checagem de FK roda POR FORA do RLS. O RLS esconde a linha de outra
pessoa da leitura; ele não impede que uma linha minha aponte para ela.

**Pré-flight antes de qualquer DDL**, só leitura: as seis consultas de
inconsistência vieram todas zeradas. A migração não conserta dado nenhum, ela
passa a recusar dado errado -- e se houvesse uma linha fora do lugar, a
constraint simplesmente não entraria.

**O comportamento de exclusão foi preservado exatamente**: as quatro relações
opcionais seguem `set null`, agora com a lista de colunas. Sem a lista, apagar
um credor tentaria anular também o `user_id`, que é `not null`, e o delete
morreria -- a exclusão de credor pararia de funcionar sem ninguém ter pedido.
`fixas_mes` segue cascade.

Ela é **reversível**, ao contrário da 002: não apaga coluna, não estreita
`check` e não toca em dado. O bloco de rollback está no fim do arquivo.

A suíte `015_ownership.sql` tem 26 casos e foi conferida nos dois sentidos:
26 de 26 com a migração aplicada, e 17 de 26 contra o estado 014, onde os
casos 3 a 7 aceitam o que deveriam recusar e os 19 a 22 mostram a meta órfã.

## O arquivo da 007 discorda do banco, em comentário

`ferramentas/confere-migracoes.mjs` acusa, e está certo: o arquivo da 007 tem
três linhas de comentário que **não** estão no texto gravado em
`schema_migrations`. Uma delas é a linha 371, `-- o RLS responde "é meu?"
sozinho`. Foram acrescentadas ao arquivo depois de a migração ter rodado.

**O DDL é idêntico**: filtrando linha de comentário e linha vazia, os dois
lados dão 377 linhas e o mesmo md5, `89a43a20df020239b5c6a5de0aeb98e1`. Nada
de estrutural está em risco, e a comparação de inventário confirma isso por
outro caminho.

Fica registrado e não corrigido: migração aplicada é imutável, e editar o
arquivo agora seria mexer no registro do que rodou. Se um dia for alinhado, o
alinhamento é do ARQUIVO ao banco, nunca o contrário, e vira uma decisão
consciente em vez de um remendo de passagem.

## O que os advisors dizem agora

Segurança: **uma única ocorrência**, e é configuração de Auth, não de schema —
proteção contra senha vazada desligada, que já era assim antes de tudo isto.
Ligar é um clique no painel e não passa por migração.

As duas ocorrências de `SECURITY DEFINER` chamável por `anon` e por
`authenticated`, que existiam desde a V1, **sumiram** com o `revoke` da 002.

Desempenho, tudo informativo e nada novo:

| O que aponta | Por que fica |
|---|---|
| `auth_rls_initplan` nas 12 policies: `auth.uid()` reavaliada por linha | o conserto é trocar por `(select auth.uid())` em **todas**, inclusive as oito da V1 — e mexer na V1 está fora do escopo. É questão de escala, e a escala aqui é um usuário |
| FKs da V1 sem índice de cobertura | a 015 cobriu as duas que passaram a ser compostas sem índice próprio (`dividas_credor_dono_idx`, `fixas_credor_dono_idx`); o resto é escala, e a escala aqui é um usuário |
| índices da V2 "não usados" | as tabelas estão vazias e nenhuma tela consulta ainda; some sozinho quando o uso começar |

## Em aberto

**A V1 continua com cartão em `credores`, e é de propósito.** A 007 criou
`cartoes` e `faturas` na V2 sem tocar na V1: migrar automaticamente credor para
cartão exigiria adivinhar qual credor é cartão, e adivinhar em cima de dado de
dinheiro é como se conta errado. Compra de cartão da V1 continua sem botão de
pagar na tela do Mês — quem paga uma compra de cartão é a fatura.

**Pagamento parcial de fatura não existe.** A `unique` da 005 recusa a segunda
liquidação da mesma fatura. Juros rotativo sem modelo de juros vira número
errado com cara de certo; até haver contrato, pagamento de fatura é integral.

**Estorno tem contrato, tem banco, tem regra e ainda não tem botão.** A 010
fechou o contrato e implementou tudo; falta só a tela, e ela não depende de
mais nenhuma decisão.

**A instalação do zero virou `supabase/bootstrap/`.** Com quinze migrações
aplicadas, `supabase-setup.sql` sozinho não reconstrói nada perto do banco
inteiro, e a ordem "V1 mais quinze migrações" não estava escrita em lugar
nenhum. `bootstrap/schema.sql` é o resultado daquela história, gerado do
catálogo, e a conferência de que ele bate com o banco é
`ferramentas/confere-schema.mjs`.
