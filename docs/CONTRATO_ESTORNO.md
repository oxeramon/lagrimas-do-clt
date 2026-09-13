# Contrato de estorno

O schema tem `natureza='estorno'` e `estorno_de_id` desde a 002, e a interface
nunca teve botão. Isso foi deliberado: **o que faltava não era código, era
decisão.** Este documento toma as decisões, e responde uma a uma as perguntas
que precisavam de resposta antes de qualquer botão existir.

## O que é um estorno

Dinheiro que voltou. A compra foi cancelada, a cobrança foi indevida, o
serviço não foi prestado. **O estorno não apaga a transação original** — as
duas aconteceram, e a segunda desfaz o efeito da primeira sem apagar o
histórico.

Apagar seria mais simples e seria errado: o extrato do banco tem as duas
linhas, e um app que discorda do extrato é um app em que não se confia.

## As onze perguntas, respondidas

| Pergunta | Resposta |
|---|---|
| Existe estorno total? | **Sim.** É o caso comum |
| Existe estorno parcial? | **Sim.** Devolveram metade, o estorno é de metade |
| Quantos estornos pode haver por transação? | **Vários.** Devolvido em duas vezes são dois estornos |
| A soma dos estornos pode passar do original? | **Não. Nunca.** O banco recusa |
| Estorno de saída vira entrada? | **Sim.** O sinal inverte |
| Estorno de entrada vira saída? | **Sim.** Simétrico |
| Como fica a categoria? | **Herda a do original.** É o que faz o relatório por categoria fechar em zero |
| Como fica a origem? | **Herda a do original**, e o vínculo real é `estorno_de_id` |
| Pode estornar transferência? | **Não** |
| Pode estornar pagamento de fatura? | **Não** |
| Pode estornar liquidação da V1? | **Não** |

## Os três "não", e por que eles não são preguiça

### Transferência

Uma transferência são **duas pernas que nascem e morrem juntas** — é o
contrato da 004, garantido por um gatilho postergado. Estornar uma perna
deixaria o par quebrado: dinheiro saindo de uma conta e não entrando em
nenhuma.

O jeito certo de desfazer uma transferência já existe e é a exclusão, que leva
as duas. Se a pessoa quer o dinheiro de volta na conta de origem, isso é outra
transferência, no sentido contrário.

### Pagamento de fatura

O pagamento é a **quitação de uma obrigação**, e o que faz a fatura ficar paga
é o vínculo em `liquidacoes` — não o sinal da transação. Um estorno devolveria
o dinheiro para a conta e deixaria a fatura dizendo "paga", com a obrigação
quitada e o dinheiro de volta no bolso. Dois estados verdadeiros e
incompatíveis.

O jeito certo já existe: apagar o pagamento. O `cascade` leva o vínculo e a
fatura volta sozinha para "a pagar", porque a situação dela é derivada.

### Liquidação da V1

Mesma forma, mesmo motivo. `desfaz_liquidacao` apaga a transação, o vínculo e a
marca da V1 numa chamada. Um estorno deixaria o compromisso marcado como pago
com o dinheiro de volta.

> **A regra por trás dos três:** transação que carrega um vínculo estrutural
> não se estorna, se desfaz. Estorno é para dinheiro que voltou; desfazer é
> para registro que não devia existir. Confundir os dois deixa o banco
> consistente e a realidade errada.

## O que o banco garante

1. **`estorno_de_id` aponta para uma transação sua.** FK composta com o dono,
   como todas as outras desde a 002 — a checagem de FK não passa por RLS.
2. **Nada se estorna a si mesmo.** Já estava na 002.
3. **O sinal do estorno é o inverso do original.** Saída vira entrada.
4. **A soma dos estornos nunca passa do original.** Gatilho postergado, pela
   mesma razão do rateio: os estornos entram um a um.
5. **Só transação de natureza `normal` é estornável.** Fecha a porta das três
   exceções acima, no banco e não numa tela.
6. **Estorno não se estorna.** Cadeia de estorno de estorno é ambiguidade pura.

## O que muda no cálculo, e é a parte que quase passou batido

Um estorno de R$ 100 de uma saída de R$ 100 **precisa zerar o consumo daquele
mês.** O saldo da conta já fecha sozinho — a entrada soma, a saída subtrai, e
a view não precisa saber de estorno nenhum.

Mas **"quanto eu gastei" não fecha sozinho**, e é fácil não perceber:

```
saída normal de 100          consumo = 100
estorno (entrada) de 100     consumo = 100   ← ERRADO, deveria ser 0
```

O filtro de consumo é `tipo='saida' e natureza='normal'`, e o estorno tem
natureza `estorno`: ele simplesmente não entra na soma. O dinheiro voltou e o
relatório continuaria dizendo que a pessoa gastou.

Então o consumo passa a ser **líquido**:

```
consumo = Σ(saída, normal) − Σ(entrada, estorno)
entradas = Σ(entrada, normal) − Σ(saída, estorno)
```

Isto vale para o consumo e para as entradas realizadas, nas duas direções, e é
a razão pela qual o contrato veio antes do botão: **o botão é fácil, a conta é
que precisava mudar.**

## Por que ainda não existe botão

Porque a mudança do cálculo precisa provar-se em número antes de virar
interface. O estorno está implementado e testado no banco e nas regras; expor a
ação é o passo seguinte, e ele não depende de mais nenhuma decisão — só de
tela.

Enquanto isso, quem precisar registrar um estorno consegue: a tabela aceita, a
RPC valida, e nenhuma das regras acima pode ser contornada.
