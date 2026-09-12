# Contrato da ponte V1 ↔ V2

Escrito **antes** do código, porque a decisão errada aqui não aparece como erro:
aparece como um número plausível e errado.

## O problema, em uma frase

Uma obrigação não é uma movimentação.

```
"eu devo R$ 500"                    compromisso   V1
"R$ 500 saíram da conta X em 12/09"  movimento     V2
```

As duas podem estar relacionadas. **Não são a mesma entidade, e somá-las conta
o mesmo dinheiro duas vezes.** Até aqui o produto resolveu isso separando
completamente as duas metades. Esta rodada as liga — sem fundi-las.

## O que a V1 já tem, e o que não tem

| | Como marca que "aconteceu" |
|---|---|
| `dividas` | linha em `pagamentos` com `(mes, item_id = <uuid da dívida>)` |
| `fixas` | linha em `pagamentos` com `(mes, item_id = 'fx:<uuid da fixa>')` |
| `receitas` | **nada.** Não existe marcador de recebimento |

Isso não é descuido: a V1 nasceu para responder "quanto falta pagar", e receita
ali é só o outro lado da conta. A ponte precisa resolver o caso da receita sem
inventar uma tabela `recebimentos` paralela e sem enfiar recebimento numa
tabela chamada `pagamentos`.

## A decisão: uma tabela de vínculo

```
liquidacoes(user_id, tipo, item_id, competencia, transacao_id, valor)
unique (user_id, tipo, item_id, competencia)
```

Uma linha aqui significa: **este compromisso, nesta competência, foi liquidado
por esta transação.**

### Por que não só `origem` / `origem_id`

As duas colunas existem em `transacoes` e são úteis — e continuam sendo
preenchidas, para filtrar sem `join`. Mas elas não bastam como identidade da
relação, por uma razão concreta:

**um compromisso da V1 não é uma linha, é uma linha × um mês.** Uma dívida de
24 parcelas é UMA linha em `dividas` e vinte e quatro obrigações distintas.
`origem_id = <uuid da dívida>` não diz *qual parcela* foi paga. Precisaria
codificar o mês dentro do texto, e texto codificado é o tipo de coisa que
ninguém consegue consultar depois.

`liquidacoes` carrega a **competência** como coluna, que é o que torna a
relação consultável nos dois sentidos.

### Por que `item_id` é texto, e não uma FK

Porque o alvo muda de tabela: dívida, fixa e, depois, fatura. Uma FK aponta
para uma tabela só. É a mesma razão pela qual `pagamentos.item_id` já é texto
na V1 — e usar **exatamente a mesma convenção** (`<uuid>` para dívida,
`fx:<uuid>` para fixa) é o que faz a marca da V1 e o vínculo da V2 falarem do
mesmo item sem tradução.

O preço: o banco não consegue garantir que o `item_id` existe. Quem garante é a
RPC, que valida antes de escrever — e valida lendo com o RLS ligado, então
compromisso de outra pessoa simplesmente não é encontrado.

### A prova de que atende os casos pedidos

| Caso | Como fica |
|---|---|
| dívida | `tipo='divida'`, `item_id=<uuid>`, competência = mês da parcela |
| conta fixa | `tipo='fixa'`, `item_id='fx:<uuid>'` |
| receita | `tipo='receita'`, `item_id=<uuid>`. **A existência da linha É o marcador de recebimento** — resolve a lacuna da V1 sem tabela nova |
| fatura (fase seguinte) | `tipo='fatura'`, `item_id=<uuid da fatura>`. Só precisa entrar no `check` |
| exclusão | FK composta com `on delete cascade`: apagar a transação apaga o vínculo, e um gatilho apaga a marca da V1 junto |
| alteração | editar valor ou data da transação não mexe no vínculo; o vínculo aponta para a transação, não copia ela |
| rastreabilidade | dos dois lados: do compromisso para a transação e da transação para o compromisso |

## As três operações

Todas são **uma chamada, uma transação de banco, tudo ou nada**. Duas chamadas
HTTP não servem, pela mesma razão da transferência: a segunda pode falhar e
deixar "marcou pago mas não criou transação".

### 1. Liquidar compromisso — `liquida_compromisso`

```
compromisso V1 → escolher conta V2 → data → valor → confirmar
```

Faz, na mesma transação:

1. cria a **saída** em `transacoes` (`natureza='normal'`, `origem='divida'|'fixa'`);
2. cria a marca em `pagamentos` — a mesma que o quadradinho da V1 cria;
3. cria a linha em `liquidacoes`.

Para quem usa, é uma operação. Por dentro continuam sendo entidades diferentes.

### 2. Receber receita — `recebe_receita`

1. cria a **entrada** em `transacoes` (`origem='receita'`);
2. cria a linha em `liquidacoes`.

Sem linha em `pagamentos`: receita não é pagamento, e a tabela tem esse nome
por um motivo. O marcador de recebimento passa a ser a própria `liquidacoes`.

### 3. Desfazer — `desfaz_liquidacao`

Apaga a transação. O `cascade` leva o vínculo, e o gatilho leva a marca da V1.
Uma chamada desfaz as três coisas.

## Regras que não se negociam

**A marca da V1 sozinha continua válida.** Quem só clica no quadradinho de pago,
sem escolher conta, segue funcionando igual. A ponte é opcional: `pagamentos`
pode existir sem `liquidacoes`. O contrário, não.

**Nada acontece automaticamente.** Criar uma transação solta na aba Transações
NÃO marca compromisso nenhum. Marcar pago no quadradinho NÃO cria transação. A
ponte só existe quando a pessoa usa o botão "Pagar" ou "Receber". Isso é
deliberado: adivinhar qual transação corresponde a qual compromisso é a
maneira mais rápida de contar dinheiro duas vezes.

**Uma liquidação por competência.** A `unique` garante. Pagar de novo o mesmo
mês do mesmo compromisso é recusado pelo banco, não pela tela.

**Apagar a transação desfaz a liquidação inteira.** Não existe transação
liquidante órfã, nem compromisso marcado como pago cuja transação sumiu.

## Liquidação parcial: fora desta rodada, de propósito

A `unique (user_id, tipo, item_id, competencia)` impede duas liquidações do
mesmo compromisso na mesma competência. Isso **exclui pagamento parcial e
recebimento parcial**, e a exclusão é uma escolha, não um esquecimento.

O motivo: a V1 não tem onde guardar "quanto ainda falta desta parcela". O
compromisso tem um valor só, e `pagamentos` é booleano — ou está marcado, ou
não. Suportar parcial exigiria mudar o significado da marca da V1, e mudar o
significado de um dado que já existe é bem mais caro do que adiar.

Quando for a hora, o caminho é: trocar a `unique` por uma soma acumulada com
`check` de não passar do valor do compromisso, e a marca da V1 passa a ser
derivada de "acumulado >= valor". Até lá, **liquidação é integral**.

## O que isto NÃO autoriza

Um indicador que some "compromissos pagos" com "saídas realizadas" continua
contando duas vezes — a liquidação é a MESMA coisa vista dos dois lados. O
lugar onde isso se resolve é o cálculo de previsto × realizado, e a regra é:

> Compromisso liquidado deixa de ser previsto e passa a ser realizado.
> Ele aparece num lado ou no outro. Nunca nos dois.
