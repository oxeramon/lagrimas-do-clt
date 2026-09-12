# Contrato de cartão e fatura

Escrito **antes** do SQL, pela mesma razão do [contrato da ponte](CONTRATO_PONTE.md):
a decisão errada aqui não aparece como erro, aparece como um número plausível e
errado.

## O problema, em duas frases

> **Compra no cartão é despesa.**
> **Pagamento da fatura não é despesa nova.**

Pagar a fatura é caixa saindo e obrigação sendo quitada. Se os dois entrarem na
mesma soma, uma compra de R$ 100 vira R$ 200 de consumo — e o app passa a
mentir exatamente sobre a pergunta para a qual ele existe.

## Duas perguntas, dois filtros, nunca uma soma

| Pergunta | Filtro | Entra | Não entra |
|---|---|---|---|
| **Quanto eu gastei?** (consumo) | `tipo='saida'` e `natureza='normal'` | compra no cartão, gasto pago da conta | pagamento de fatura, transferência, estorno |
| **Quanto saiu da conta?** (caixa) | `conta_id is not null` e status que conta | pagamento de fatura, gasto pago da conta | compra no cartão |

A compra no cartão **não tem `conta_id`**: nenhum dinheiro saiu de conta
nenhuma quando ela aconteceu. O pagamento da fatura **não tem `fatura_id`**:
ele não é item da fatura, é a quitação dela.

É essa assimetria que torna a dupla contagem **impossível de escrever**, e não
apenas improvável. Nenhum dos dois filtros precisa conhecer o outro.

### A prova aritmética, que virou o CASO A dos testes

```
compra no cartão            R$ 100   saida/normal   fatura_id=F   conta_id=NULL
pagamento da fatura F       R$ 100   saida/pagamento_de_fatura    conta_id=C

consumo   = 100     (só a compra entra)
caixa     = 100     (só o pagamento entra)
fatura F  = 100 de total, 100 de pago, situação "paga"
```

Nunca 200. Em nenhum dos dois.

## Cartão é entidade, não credor

A V1 trata cartão como uma linha em `credores` com `dia_fechamento` e
`dia_vencimento`. Funciona para o que a V1 faz e não comporta limite, conta
padrão de pagamento, nem fatura como coisa. Na V2 cartão é `cartoes`.

### O que o cartão guarda

instituição, nome, apelido, **últimos quatro dígitos (opcionais)**, limite, dia
de fechamento, dia de vencimento, conta padrão para pagar, cor, ordem, ativo.

### O que o cartão NUNCA guarda

Número completo. CVV. Validade. Senha. Token. Nome impresso.

Quatro dígitos bastam para a pessoa saber de qual cartão se trata, e é o máximo
que este produto tem motivo para saber. O `check` do banco recusa qualquer
coisa que não sejam exatamente quatro dígitos — não é validação de conforto, é
o que impede um número inteiro de entrar no campo por descuido.

## O ciclo, formalizado

Ambiguidade de ciclo é a fonte clássica de erro em cartão. Então a regra fica
escrita aqui e implementada uma vez só, no banco.

Para um cartão com dia de fechamento `F` e dia de vencimento `V`, e uma
competência `M` (um mês, `AAAA-MM`):

```
fechamento(M) = dia min(F, último dia de M) do mês M
abertura(M)   = fechamento(M-1)
vencimento(M) = dia min(V, último dia de Mv) do mês Mv
                onde Mv = M      se V > F
                         M + 1   se V <= F
```

E a pergunta que importa, a de qual fatura recebe uma compra feita em `D`:

```
competência(D) = mês(D)       se dia(D) <  fechamento-dia(mês(D))
                 mês(D) + 1   se dia(D) >= fechamento-dia(mês(D))
```

A janela da competência `M` é **meio aberta**: `abertura(M) <= D < fechamento(M)`.
A data de fechamento pertence à competência seguinte, não a esta — é o que a
regra do `>=` logo abaixo diz, escrito como intervalo.

### Por que `>=` e não `>`

**Compra feita no próprio dia do fechamento já cai na fatura seguinte.** O
extrato é cortado naquele dia. Com `>`, o app cobraria a compra um mês antes do
que o cartão cobra — e o erro só apareceria no dia do fechamento, uma vez por
mês, que é o pior tipo de defeito.

É a mesma regra que a V1 já usa em `js/domain/billing.js`. Mudar de opinião
agora faria as duas metades do app discordarem sobre a mesma compra.

### O truncamento, e por que ele é do mês e não do cartão

Fechamento dia 31 em fevereiro não existe. `min(F, último dia do mês)` resolve:
em fevereiro de um ano comum o fechamento cai em 28, em bissexto em 29, e em
abril em 30. O dia guardado no cartão **não muda**; quem trunca é o cálculo do
ciclo, mês a mês. Guardar o dia já truncado perderia a informação de que o
cartão fecha no último dia.

### Competência é o ciclo que fecha, não o mês em que se paga

Esta é a decisão mais fácil de errar de nome, e nome de número já custou caro
neste projeto.

`competencia = '2026-09'` significa **o ciclo que fecha em setembro**. Se o
cartão fecha dia 25 e vence dia 8, essa fatura **vence em 08/10** — e a pessoa
vai chamá-la de "fatura de outubro", porque é quando ela paga.

Por isso a interface **nunca** rotula uma fatura com um mês solto. Ela mostra
as duas datas: *"fecha 25/09 · vence 08/10"*. O mês cru fica no banco, onde é
usado para contas, e não na tela, onde seria lido errado.

## Fatura: uma linha, nenhum total guardado

`faturas` guarda o que **não se deriva**: qual cartão, qual competência, e as
três datas do ciclo já resolvidas (abertura, fechamento, vencimento). Um
`unique (user_id, cartao_id, competencia)` garante que não existem duas faturas
do mesmo ciclo.

O que ela **não** guarda:

| Derivado | De onde sai |
|---|---|
| total | soma das transações com `fatura_id` daquela fatura |
| pago | existe vínculo em `liquidacoes` com `tipo='fatura'` |
| situação | `paga` se há vínculo; senão `fechada` se hoje já passou do fechamento; senão `aberta` |

A view `faturas_resolvidas` entrega os três. Guardar o total como coluna criaria
dois números com o mesmo nome, e eles discordariam no primeiro estorno.

### As faturas nascem sob demanda

Nada de gerar doze meses de faturas por cartão. `fatura_do_cartao(cartao, data)`
encontra a fatura do ciclo daquela data **ou cria**, e devolve o id. Chamar duas
vezes com a mesma data devolve a mesma fatura: quem garante é o `unique`, não a
aplicação.

É a mesma estratégia que as recorrências vão usar. Materializar sob demanda, em
horizonte curto, com idempotência garantida pelo banco.

## Compra parcelada: uma compra, N parcelas com identidade

Uma compra parcelada é **uma** decisão e **N** obrigações — a mesma forma da
dívida da V1, e o mesmo motivo pelo qual a ponte precisou de competência.

```
compras_de_cartao   a compra lógica: descrição, valor total, data, N parcelas
transacoes          uma linha por parcela, com compra_id + parcela + fatura_id
```

Cada parcela sabe de qual compra veio, qual é o seu número, quantas são, e em
qual fatura caiu. **Nada disso é texto.** A V1 identificava parcela por sufixo
no id (`_1`, `_2`); aqui é coluna, é `integer`, e é consultável.

Um `unique (user_id, compra_id, parcela)` impede a mesma parcela nascer duas
vezes, e um `check` amarra `parcela <= total_parcelas`.

### O consumo de uma parcela é do mês da parcela

Economicamente a decisão de gastar aconteceu uma vez, na compra. Este app
responde "quanto sai este mês", e por isso **cada parcela é despesa do ciclo em
que ela cai** — é o que a V1 já faz, é o que o extrato do cartão diz, e é o que
a pessoa precisa saber para pagar a conta.

O valor total da compra fica em `compras_de_cartao`, para quem quiser a outra
resposta. As duas existem; elas não se somam.

## Pagar a fatura: uma chamada, uma transação de banco

```
fatura → escolher conta → data → confirmar valor → pagar
```

`paga_fatura` faz, tudo ou nada:

1. cria a **saída** em `transacoes`, com `natureza='pagamento_de_fatura'`,
   `conta_id` preenchido e `fatura_id` **vazio**;
2. cria a linha em `liquidacoes` com `tipo='fatura'` e `item_id` = id da fatura.

O vínculo é o mesmo mecanismo da 005 — não havia razão para inventar um
segundo. Apagar a transação leva o vínculo pelo `cascade`, e a fatura volta
sozinha para "fechada", porque a situação é derivada e não guardada.

`liquidacoes.tipo` ganha `'fatura'`. Era o caso previsto no contrato da ponte,
com o texto "só precisa entrar no check" — e era mesmo só isso.

### Pagamento parcial de fatura: fora desta rodada, de propósito

A `unique (user_id, tipo, item_id, competencia)` da 005 impede duas liquidações
da mesma fatura. Isso **exclui pagamento parcial**, e a exclusão é escolha, não
esquecimento: pagamento parcial de fatura tem juros rotativos, e juros rotativo
sem modelo de juros vira um número errado com cara de certo.

Até haver contrato para isso, **pagamento de fatura é integral**. A tela diz
isso antes do clique, não depois.

## O que este contrato NÃO autoriza

Somar `total das faturas abertas` com `saídas realizadas` continua contando o
mesmo dinheiro duas vezes. A fatura aberta é **obrigação**; a saída realizada é
**caixa**. Elas vão para blocos diferentes do Início, e a fórmula que as
juntar, se um dia existir, precisa estar escrita antes de aparecer na tela.
