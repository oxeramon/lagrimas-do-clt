# Arquitetura V2

O que existe hoje depois da reorganização, o que está preparado para depois, e
quais dependências são permitidas. Este documento é o contrato de estrutura;
`CONTRATOS_V1.md` é o contrato de comportamento.

## O que mudou, em uma frase

O `index.html` deixou de ser o sistema inteiro. Núcleo e domínio saíram para
`js/`, como ES Modules servidos ao lado dele. Continua sem bundler, sem npm e
sem passo de build para produção: o navegador resolve os caminhos, e o GitHub
Pages entrega por HTTPS.

## Estrutura

```
index.html            4554 linhas · HTML e o render da V1
                      um segundo <script> de 15 linhas no <head>, só para o tema

css/
  tokens.css    125   cores, espaços, pesos. Um bloco escuro, e só um
  base.css      709   o que a V1 já usava
  views-v2.css  403   contas, cartões, assinaturas, grupos

js/
  core/               não conhece dinheiro nem dívida
    state.js     23   o espelho do banco em memória
    money.js     26   formatação e o piso do que conta como valor
    dates.js     39   mês como índice inteiro, nunca como Date
    escape.js     6   esc(), antes de qualquer innerHTML
    dom.js        6   o único atalho de DOM do projeto

  domain/             conhece dinheiro, NÃO conhece DOM
    debts.js         161  parcela, saldo, quitado, prazo, progresso, rateio
    income.js         46  receita pontual e recorrente como intervalo
    creditors.js      35  hierarquia banco/cartão de dois níveis
    fixed.js          34  conta fixa e a média que não reescreve o passado
    billing.js        26  em que fatura uma compra cai, na régua da V1
    accounts.js      102  tipos, liquidez e os indicadores de conta
    categories.js     78  árvore de até três níveis, entrada e saída separadas
    transactions.js  135  sinal, filtro, agrupamento, totais
    reconciliation.js 164 previsto × realizado, e o que NÃO se soma
    cards.js         200  ciclo da fatura, consumo × caixa, parcelamento
    subscriptions.js  92  regra de assinatura e custo equivalente
    groups.js        112  divisão em centavos, saldos e quem paga a quem

  data/               a única porta para o Supabase
    client.js         65  conexão, erro legível, embrulho { dados, erro }
    session.js        33  entrar, sair, observar
    v1-repository.js 110  as oito tabelas da V1
    v2-repository.js 346  as treze da V2, e todas as RPCs

  ui/                 conhece DOM
    navigation.js    153  o registro de abas, e a lateral montada a partir dele
    v2-screens.js   1887  contas, cartões, assinaturas, grupos, transações
    institution-catalog.js 67   marcas conhecidas e o monograma de reserva
    category-catalog.js    62   a árvore padrão de categorias

supabase/
  migrations/          dez, todas aplicadas; ver docs/MIGRACOES.md
  testes/              casos que rodam no banco real e terminam em rollback
supabase-setup.sql     instalação limpa da V1

testes/
  regras.mjs      297 casos de cálculo, importando os módulos de produção
  fluxos.mjs      204 casos que dirigem a interface num navegador de verdade
  preview.mjs     gera preview.html com o Supabase dublado
  audita.mjs      auditoria de repositório público
```

## Dependências: o que pode e o que não pode

```
        index.html  ──▶  js/ui  ──▶  js/domain  ──▶  js/core
             │                           │              ▲
             └───────────────────────────┴──────────────┘
                    (os dois podem usar core)
```

| De | Para | Pode? |
|---|---|---|
| `core` | qualquer coisa | **não.** `core` não importa nada do projeto, só `core` |
| `domain` | `core` | sim |
| `domain` | `domain` | sim, sem ciclo |
| `domain` | `ui`, `data`, `document`, `window` | **não** |
| `ui` | `core`, `domain` | sim |
| `ui` | `ui` | sim, sem ciclo |
| `index.html` | qualquer módulo | sim |
| qualquer módulo | `index.html` | **não**, e é impossível: ele não exporta |

Proibido, e o motivo:

- **`domain` tocando DOM.** É o que torna a regra testável sem navegador. Se
  uma função de domínio precisa de `document`, ela está fazendo duas coisas.
- **Regra financeira em dois lugares.** Um cálculo tem um endereço, e ele é
  `js/domain/`. Nada de uma cópia no `index.html` "por conveniência".
- **`core` conhecendo dívida.** `money.js` formata qualquer número; se ele
  souber o que é parcela, a camada virou nome sem conteúdo.
- **Ciclo de import.** Quase sempre é camada invertida. O hook barra.

Quem cobra: `.claude/hooks/checa-modulos.mjs`, a cada Write/Edit. Ele confere
que o import aponta para arquivo existente **com o caminho exato** (o Pages roda
em Linux e diferencia maiúscula), que o nome importado é de fato exportado, e
que não há ciclo.

## O que ainda está no index.html

Render das seis abas, os seis diálogos, listas suspensas e calendário escritos à
mão, importação de CSV, sessão, e o acesso ao Supabase. É dívida técnica
conhecida e está na lista de próximos passos. A fronteira que já vale: **nada
disso calcula dinheiro**. O cálculo já saiu.

## A prévia e o limite do `file://`

O navegador recusa `import` a partir de `file://` -- a origem é `null` e o CORS
bloqueia. No ar isso não existe, porque o Pages serve por HTTPS.

Mas a prévia existe para ser aberta com dois cliques. Então `testes/preview.mjs`
achata o grafo de módulos num script só, e **só ele** faz isso: é ferramenta de
inspeção local, não empacotamento de produção. O achatador é deliberadamente
burro e para com mensagem clara se aparecer `export default`, `export {}`,
renomeação em import ou import dinâmico. Recusar é melhor do que gerar uma
prévia sutilmente errada.

Consequência prática: **abrir `index.html` direto do disco não funciona mais.**
Para olhar a tela localmente, use a prévia.

## Modelo conceitual da V2

```
instituição
    ├── contas        corrente, poupança, carteira, investimento, FGTS
    └── cartões       fase seguinte; hoje cartão ainda é `credores`

contas
    └── transações    movimento que ACONTECEU

compromissos
    └── dividas       a tabela da V1, intocada
```

Oito distinções que o modelo mantém separadas:

| | |
|---|---|
| instituição ≠ conta | o banco não é a conta corrente dele |
| conta ≠ credor | de onde o dinheiro sai não é a quem se deve |
| cartão ≠ credor | o cartão é o instrumento, o banco é o credor |
| dívida ≠ transação | obrigação não é movimento |
| pagamento ≠ transação | marcar como pago é ato de controle |
| receita prevista ≠ entrada realizada | |
| fatura ≠ gasto | a fatura agrupa gastos, não é um gasto |
| pagar a fatura ≠ gastar | é liquidação, não despesa nova |

A última é a que mais dá errado: lançar o pagamento da fatura como despesa conta
o mesmo dinheiro duas vezes.

## Regras financeiras da V2, registradas agora

**`tipo` é o sinal; `natureza` é o que aconteceu.** Esta é a decisão da qual
todas as outras saem:

```
tipo      entrada | saida                      o efeito no saldo, sempre
natureza  normal | transferencia | estorno     o que é, economicamente
```

Enquanto `tipo` valia `transferencia` e `estorno`, o sinal ficava ambíguo e
toda conta precisava de caso especial. Separar os dois eixos resolve os dois
problemas de uma vez.

**Saldo de conta é derivado, e a conta não tem exceção.**

```
saldo = saldo_inicial + entradas realizadas − saídas realizadas
```

Contado a partir de `saldo_inicial_em`. Não existe coluna `saldo_atual` como
fonte primária: qualquer transação perdida ou duplicada faria a coluna divergir
do extrato, e aí ninguém sabe qual dos dois está certo. A view
`saldos_de_conta` é a implementação, com `security_invoker` ligado -- sem isso
ela seria um furo no RLS. A coluna pode voltar depois como **cache**.

**Cartão.** A compra é a despesa. O pagamento da fatura é liquidação de
obrigação e movimentação de caixa, nunca uma segunda despesa.

**Dívida.** `dividas` representa obrigação. Uma transação futura poderá
registrar o movimento decorrente do pagamento de uma parcela, ligada por
`origem = 'divida'` e `origem_id`.

**FGTS.** Conta com `liquidez = 'restrita'`, não receita mensal. É patrimônio e
não paga a conta de luz. Como receita ele apareceria todo mês, o que é falso.

**Transferência.** Duas linhas com o mesmo `transferencia_id`: uma `saida` na
conta de origem, uma `entrada` na de destino, mesmo valor. Ela não aparece na
fórmula do saldo, e é esse o ponto -- as duas pernas já são entrada e saída
comuns, cada conta fecha sozinha e o patrimônio consolidado não se mexe.

O grupo comum substituiu o par circular: com uma FK de cada perna para a outra,
era preciso inserir uma linha incompleta antes da outra existir. Quem garante
que o par está inteiro é um gatilho de constraint **diferido**, que confere no
commit -- as duas pernas podem nascer em qualquer ordem dentro da transação, e
o que não passa é a transação terminar pela metade.

**Estorno.** Linha de sinal contrário ao da original, ligada a ela por
`estorno_de_id`. Estornar uma saída é uma `entrada`; estornar uma entrada é uma
`saida`. O sinal continua saindo do `tipo`, e `natureza` só conta a história.

**Dono é integridade, não visibilidade.** Toda FK entre objetos de usuário é
composta por `(user_id, coluna)`. A checagem de FK roda por fora do RLS, por
definição do Postgres, então sem isso uma linha podia apontar para objeto
alheio -- e RLS esconde, não impede.

## As tabelas da V2

Dez migrações aplicadas; o histórico completo está em
[`MIGRACOES.md`](MIGRACOES.md).

| Tabela | Guarda | Migração |
|---|---|---|
| `instituicoes` | nome, tipo, logo, cor de marca | 001 |
| `contas` | instituição, tipo, saldo inicial e sua data, liquidez | 001 |
| `categorias` | árvore de até 3 níveis, entrada e saída separadas | 001 |
| `transacoes` | conta **ou** fatura, categoria, tipo, natureza, valor, data, status, origem, transferência, estorno, compra, parcela, assinatura, competência | 001, 007, 008 |
| `liquidacoes` | a ponte: qual compromisso, de qual competência, por qual transação | 005 |
| `cartoes` | ciclo, limite, conta padrão, **no máximo quatro dígitos** | 007 |
| `faturas` | cartão, competência e as três datas do ciclo | 007 |
| `compras_de_cartao` | a compra lógica que vira N parcelas | 007 |
| `assinaturas` | a REGRA: valor, frequência, início, fim | 008 |
| `grupos`, `membros` | grupo e quem participa. Nome e apelido, nada mais | 009 |
| `despesas_do_grupo`, `rateios` | a despesa e as partes, com a soma cobrada pelo banco | 009 |
| `acertos` | a quitação da obrigação, com vínculo opcional a uma transação | 009 |

E cinco views, todas `security_invoker`: `saldos_de_conta`,
`faturas_resolvidas`, `assinaturas_resolvidas`, `saldos_do_grupo` e
`transacoes_com_estorno`. **Nenhuma delas guarda o que dá para derivar** --
total de fatura, situação, custo equivalente e saldo de grupo saem da view, e
não de coluna.

## Os quatro contratos

Cada um foi escrito **antes** do SQL correspondente, porque a decisão errada
nestes pontos não aparece como erro: aparece como número plausível e errado.

| Contrato | A frase que o resume |
|---|---|
| [ponte V1↔V2](CONTRATO_PONTE.md) | compromisso liquidado deixa de ser previsto e passa a ser realizado; aparece num lado ou no outro, nunca nos dois |
| [cartão e fatura](CONTRATO_CARTAO.md) | compra no cartão é despesa; pagamento da fatura não é despesa nova |
| [estorno](CONTRATO_ESTORNO.md) | transação que carrega vínculo estrutural não se estorna, se desfaz |
| assinatura (na 008) | assinatura é REGRA, ocorrência é EVENTO |

Os quatro são o mesmo cuidado visto de ângulos diferentes: **duas coisas que se
relacionam não são a mesma coisa, e somá-las conta o mesmo dinheiro duas
vezes.**

### Os quatro invariantes que viraram teste permanente

| | Situação | Resposta certa |
|---|---|---|
| A | compra no cartão 100 + pagamento da fatura 100 | consumo 100, caixa 100. Nunca 200 |
| B | compromisso de 500 + o pagamento dele | 500 no mês. Nunca 1.000 |
| C | transferência de A para B | patrimônio inalterado |
| D | receita prevista 1.000 + o recebimento | 1.000 no mês. Nunca 2.000 |

## Estratégia de migração

1. Toda tabela nova leva os quatro blocos no mesmo commit: `user_id` com
   cascade, `enable row level security`, policy por `auth.uid()` com `using` e
   `with check`, trigger `set_user_id` e índices.
2. Toda migração tem seção de **conferência** e de **rollback**, com a condição
   sob a qual desfazer ainda é seguro.
3. Idempotente do começo ao fim: `if not exists`, `drop policy if exists`.
4. Nada de `raise exception` fora de erro real: um `do $$` que aborta derruba as
   seções seguintes.
5. **O SQL roda antes do deploy.** Publicar código que consulta tabela que não
   existe derruba o app.
6. Migração não carrega dado.
7. **Migração aplicada é imutável.** Quando o arquivo e o banco discordam, some
   a única fonte confiável sobre o que rodou. Conserto vira migração nova --
   foi por isso que a 003 existe em vez de um remendo na 002.
8. Migração que muda regra de modelo vem com teste em `supabase/testes/`, que
   roda no banco de verdade dentro de uma transação e termina em `rollback`.

`supabase/README.md` explica a ordem dos arquivos.

## Segurança

O repositório é público e a chave publicável fica visível no HTML. **RLS é a
única coisa que separa os dados de quem abrir o site.**

Duas exceções explícitas e mais nenhuma: `SUPABASE_URL` e a chave
publishable/anon. Qualquer outra credencial é crítica.

Dado real não entra em arquivo versionado, nem temporariamente. A regra está no
topo do `CLAUDE.md`, o critério em
`.claude/skills/public-repo-hygiene/SKILL.md`, e a parte automática em
`testes/audita.mjs` -- que roda a cada edição pelo hook e antes de cada push.

O cruzamento com valores conhecidos da base antiga é opcional e mora **fora** do
repositório, em `SANITIZATION_BASELINE_PATH`: publicar a lista dos dados
proibidos seria publicar os dados.

## Dívida técnica conhecida

| O quê | Onde |
|---|---|
| Render da V1, diálogos, CSV e sessão ainda no `index.html` | ~3.200 linhas de JS |
| `v2-screens.js` passou de 1.800 linhas e comporta quatro telas | `js/ui/v2-screens.js` |
| A regra do ciclo do cartão e a divisão em centavos existem em SQL e em JS | 007/009 e `cards.js`/`groups.js`; amarradas pelos mesmos casos de teste |
| `fixasEstimadas` existe e nunca é chamada | `js/domain/fixed.js` |
| "Sobra" do Painel e "Sobra estimada" do Mês podem divergir | `renderPainel` e `renderMes` |
| Rateio da V1 não chega ao fluxo nem à projeção | `totalDividas` |
| `pagamentos` carregada sem paginação; PostgREST corta em 1000 | `carregaAgora` |
| Assinatura semanal é cadastrada e não vira ocorrência | 008, declarado em três lugares |
| Pagamento parcial de fatura não existe | 007, por causa de juros rotativo |
| Estorno tem contrato, banco e regra, e não tem botão | 010 |
| `auth.uid()` reavaliada por linha nas policies | aceito; a escala aqui é um usuário |
| Instalação do zero já não cabe num arquivo só | `supabase-setup.sql` + dez migrações |
| Nenhum hook confere ESCOPO de identificador entre módulos | dois erros assim só apareceram no navegador |

## Roadmap

**Feito:** contas, transações, transferências, a ponte com a V1, previsto ×
realizado, cartões, faturas, parcelamento, pagamento de fatura, assinaturas com
recorrência, grupos com rateio e acerto, e o contrato de estorno.

**Agora:** o botão de estorno -- a regra já está provada, falta a tela. E o
calendário financeiro, que hoje é a lista do Mês.

**Em seguida:** metas; quebrar `v2-screens.js` por tela; tirar o render da V1
do `index.html`.

**Fora de escopo, e continua fora:** WhatsApp, IA, OCR, chatbot, agente
financeiro, classificação automática e importação bancária automática.

A ordem importa: cada uma depende da anterior estar testada.
