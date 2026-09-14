# Contrato de Sobra e Capacidade

> Quanto sobra, quanto disso já tem dono, e quanto cabe prometer.

Escrito **antes** do código, como o de Metas e o de Cartão, porque a pergunta é
financeira e não visual: *o que é "sobrar"?* A resposta errada aqui produz um
app que promete dinheiro que não existe, e parece certo enquanto ninguém soma à
mão.

## O defeito que este contrato existe para consertar

Até aqui o Painel mostrava uma linha chamada **"Sobra projetada"** com este
número:

```
saldo em contas  +  ainda entra  −  ainda sai
```

A expressão está **certa**. O nome está **errado**, e é o tipo de erro que este
projeto já pagou caro três vezes: a expressão responde outra pergunta.

Aquilo é **saldo ao fim do mês**: quanto o banco deve dizer no dia 30. Não é
sobra: sobra é o que o MÊS produziu, e não inclui o que já estava na conta no
dia 1.

Com saldo de 10.000 e um mês que entra 3.000 e sai 3.000, aquele número dizia
"sobra projetada 10.000". O mês não sobrou 10.000. O mês sobrou **zero**.

## Os três números, e por que nenhum se soma ao outro

| | O que é | De onde vem |
|---|---|---|
| **Saldo em contas** | o que existe AGORA | view `saldos_de_conta`, e só ela |
| **Sobra do mês** | o que ESTE mês produz | entradas menos saídas do período |
| **Saldo projetado** | o que deve existir no dia 30 | saldo de hoje mais o que ainda falta acontecer |

**Saldo é estoque. Sobra é fluxo.** Somar os dois é somar metros com
metros por segundo.

E repare no que **não** é o saldo projetado:

```
saldo projetado  =  saldo em contas  +  sobra PREVISTA
saldo projetado  ≠  saldo em contas  +  sobra PROJETADA
```

A segunda conta o realizado duas vezes: o que já entrou e saiu neste mês **já
está dentro do saldo de hoje**. Esta é a armadilha central do arquivo, e a
razão de o nome `sobraProjetada` ter sido aposentado em vez de reaproveitado --
reaproveitar teria mudado o sentido de um número sem mudar o nome dele, que é
como um defeito atravessa uma revisão.

## A fórmula da sobra

```
sobra realizada  =  entradas realizadas  −  saídas realizadas
sobra prevista   =  entradas previstas   −  saídas previstas
sobra projetada  =  sobra realizada  +  sobra prevista
```

### O que entra em cada parcela

| Parcela | Entra | NÃO entra |
|---|---|---|
| entradas realizadas | transação de entrada, natureza normal, com conta, status realizada ou conciliada | previsão; entrada sem conta; estorno de entrada (desconta) |
| saídas realizadas | o CAIXA do mês: saída com conta, incluindo pagamento de fatura | compra no cartão (não tem conta, ninguém pagou ainda); transferência |
| entradas previstas | receita da V1 ainda não liquidada naquela competência | receita já recebida |
| saídas previstas | compromisso em ABERTO na competência | compromisso liquidado; compromisso marcado pago sem movimento |

### Por que nada é contado duas vezes

Cada regra abaixo já existia; o que este contrato faz é declarar que a sobra
**depende** delas, e por isso nenhuma pode ser afrouxada sem revisar este
arquivo.

- **Compromisso liquidado** sai do previsto e entra no realizado pela
  transação. Nunca nos dois (`docs/CONTRATO_PONTE.md`).
- **Compromisso marcado pago sem movimento** vai para uma caixa própria e não
  entra em lado nenhum: não houve saída de dinheiro, e fingir que houve
  inventaria um gasto.
- **Transferência** não entra em nada. Ela não é receita nem despesa: muda de
  gaveta, e o total não se mexe.
- **Compra no cartão** não é caixa. Quando ela acontece, nenhum dinheiro saiu
  de lugar nenhum. Quem sai do caixa é o pagamento da fatura, depois
  (`docs/CONTRATO_CARTAO.md`).
- **Estorno** desconta do lado a que pertence: estorno de entrada reduz
  entradas, estorno de saída reduz saídas (`docs/CONTRATO_ESTORNO.md`).
- **Assinatura** materializa como transação `prevista`; ela entra na sobra
  quando for confirmada, como qualquer outra.

## Realizado, previsto e projetado, separados na tela

Os três aparecem **lado a lado e nunca fundidos**:

```
já aconteceu       sobra realizada
ainda falta        sobra prevista
o mês inteiro      sobra projetada
```

Previsão não vira saldo bancário por ser exibida. O saldo continua sendo o que
a view diz.

## Capacidade mensal para metas

```
capacidade mensal  =  max(0, sobra projetada do mês)
```

É **fluxo**: o que o mês produz e que, em princípio, pode virar reserva.

E existe o teto de **estoque**, que é outra pergunta:

```
cabe reservar agora  =  saldo LIVRE  −  já reservado em metas
```

Só o saldo **livre** entra. Restrito e bloqueado ficam de fora: dinheiro preso
não pode ser prometido a uma viagem. Já reservado também fica de fora, senão o
mesmo real seria prometido a duas metas.

Uma reserva só acontece quando **cabe nos dois**:

```
reserva possível  =  min(capacidade mensal, cabe reservar agora)
```

O banco garante o segundo teto por gatilho. O primeiro é decisão de
planejamento, e mora no frontend, onde o plano mora.

### Quando a capacidade é DESCONHECIDA, e não zero

Se o mês não tem entrada nenhuma -- nem realizada nem prevista --, a capacidade
é `null`, não zero.

Zero afirmaria "este mês não produz nada". `null` diz "ainda não dá para
saber", que é a verdade num app recém-instalado ou num mês ainda não
preenchido. A diferença é prática: com zero, toda meta com prazo nasceria
marcada em risco no primeiro minuto de uso, e alarme que toca sozinho ensina a
ignorar alarme.

## Ritmo da meta

```
necessidade mensal  =  (valor alvo − reservado) ÷ meses até o prazo
```

Meses até o prazo é **pelo menos 1**. Sem prazo não há necessidade mensal, e a
resposta é `null` -- zero diria "não precisa guardar nada", que é o oposto.

```
necessidade total  =  soma das necessidades mensais das metas ativas com prazo
capacidade restante  =  capacidade mensal  −  necessidade total
```

`capacidade restante` negativa é o sinal do CONJUNTO: cada meta pode caber
sozinha e mesmo assim não caberem todas juntas.

## Status da meta

Cinco estados, e cada um tem fundamento objetivo. Nenhum sai de porcentagem
inventada.

| Estado | Regra | Por que este corte |
|---|---|---|
| **concluída** | `status = concluida`, ou falta ≤ 0 | não há ritmo a julgar |
| **sem prazo** | `prazo` nulo | sem prazo não existe necessidade mensal |
| **sem referência** | capacidade mensal desconhecida | julgar sem base é alarme falso |
| **em risco** | necessidade mensal **>** capacidade mensal | o mês não produz o que esta meta sozinha pede |
| **atenção** | cabe sozinha, mas necessidade **total** > capacidade | cabe ela; não cabem todas |
| **no ritmo** | cabe sozinha e cabe no conjunto | |

A ordem de avaliação é a da tabela, de cima para baixo. A primeira que casar
vence.

**Prazo próximo NÃO é risco.** Uma meta que vence mês que vem e já tem o valor
inteiro reservado está concluída, não em risco. O que cria risco é a conta não
fechar, e só ela.

## Alocação recorrente

Uma meta pode ter uma regra: *reservar R$ X por mês*.

| | |
|---|---|
| Cria transação? | **Não.** Alocar não é movimento. Vale o contrato de Metas inteiro |
| Roda sozinha? | **Não.** Quem dispara é a pessoa, pela tela. Não há agendador |
| Duas vezes na mesma competência? | **Uma alocação só.** Garantido pelo banco, não por `if` de tela |
| Reversível? | **Sim.** Liberar é uma linha de valor negativo, como qualquer alocação |
| Rastreável? | **Sim.** A alocação nasce marcada como vinda de regra, com a competência |

### Quando não há dinheiro para a regra inteira

Regra de 500, disponível de 300.

**Reserva 300.** Não 500, não zero.

- **500 seria mentira.** O banco recusaria, e fingir que reservou produziria um
  número que não existe.
- **Zero perderia o mês inteiro** por causa de 200 que faltaram. A meta anda
  300 mais perto, e andar 300 é melhor do que não andar.

O que faltou não vira estado novo: ele se **deriva** comparando o valor da
regra com o que foi alocado naquela competência. Guardar "faltou 200" numa
coluna seria guardar uma subtração, e este projeto não guarda o que se calcula.

Se o disponível for zero ou negativo, **nada é alocado** e nenhuma linha é
criada. Uma alocação de zero não é informação, é ruído no histórico.

**Nunca** se aloca valor negativo pela regra, e **nunca** acima do disponível.

## O calendário NÃO mostra alocação de meta

A pergunta foi feita, e a resposta é não. Vale escrever o porquê, porque "só se
ajudar" é o tipo de decisão que alguém reabre daqui a seis meses.

O calendário responde **uma** pergunta: *em que dia o dinheiro entra e sai da
conta*. É por isso que ele é útil para quem está apertado -- ele diz se dá para
esperar até sexta.

Uma alocação de meta não entra nessa pergunta. Nenhum dinheiro se move, nenhuma
conta muda de saldo, e o dia da alocação é uma data administrativa, não um
evento de caixa. Pôr uma reserva de 500 no dia 1 ao lado de uma conta de luz de
500 no dia 5 faria as duas parecerem a mesma coisa, e elas são opostas: uma
tira dinheiro da conta, a outra não tira nada de lugar nenhum.

Seria, em uma frase, misturar estoque com fluxo numa tela que existe
inteiramente para separar os dois no tempo. A reserva do mês já aparece onde
ela é a resposta: no cartão da meta e no bloco de Metas do Painel.

## O que este contrato NÃO resolve

- **Sobra de meses futuros.** A projeção de vários meses é outra tela
  (Projeção) e outro contrato. Aqui a sobra é a do mês em foco.
- **Regra que dispara sozinha.** Sem agendador, a regra é aplicada quando a
  pessoa manda. Automatizar exige decidir o que acontece com meses passados
  não aplicados, e essa decisão não foi tomada.
- **Meta que gasta de dentro de si.** Continua como está: quando a compra
  acontece, é uma transação normal, e a meta se conclui à mão.
