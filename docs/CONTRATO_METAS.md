# Contrato de Metas

> Sonhos com centro de custo.

Escrito **antes** da migração e antes da tela, porque a pergunta que Metas faz é
financeira e não visual: *uma meta cria dinheiro?* A resposta errada aqui
produz um app que soma o mesmo real duas vezes e parece certo.

## A frase que governa tudo

**Meta é envelope. Conta é onde o dinheiro está.**

Uma meta **não cria dinheiro**, **não move dinheiro** e **não altera saldo
bancário**. Ela declara um destino para dinheiro que já existe.

O erro que este contrato existe para impedir:

```
Saldo da conta          R$ 10.000
Meta "Viagem"           R$  5.000
                        ─────────
"Patrimônio"            R$ 15.000     ← ERRADO. São os mesmos 10.000.
```

Os 5.000 da meta **estão dentro** dos 10.000 da conta. Não ao lado.

## As sete perguntas, respondidas

| Pergunta | Resposta |
|---|---|
| Meta cria dinheiro? | **Não. Nunca.** |
| Meta reduz o saldo da conta? | **Não.** O saldo bancário é o que o banco diz |
| Meta reduz o "disponível para gastar"? | **Sim.** É exatamente para isso que ela serve |
| Alocar gera transação? | **Não.** Não houve movimento; houve intenção |
| Posso reservar mais do que tenho? | **Não.** O banco recusa |
| Meta aparece no cálculo de gasto do mês? | **Não.** Reservar não é gastar |
| Meta paga alguma coisa? | **Não.** Quando o gasto acontece, ele é uma transação normal |

## Os dois números, e por que eles não se somam

```
saldo em contas              o que o banco diz que você tem
  − reservado em metas       o que você já prometeu a um objetivo
  ─────────────────────
= disponível não reservado   o que dá para gastar sem quebrar um plano
```

`disponível não reservado` é **uma leitura diferente do mesmo dinheiro**, não um
dinheiro a mais. Somar `saldo` com `reservado` conta o mesmo real duas vezes, e
é o defeito que este documento existe para tornar impossível de escrever sem
perceber.

### Qual saldo entra na conta

Só o **livre**. Contas marcadas como `restrita` ou `bloqueada` não entram na
base do que pode ser reservado: dinheiro preso não pode ser prometido a uma
viagem. `js/domain/accounts.js` já separa os três (`livre`, `restrito`,
`bloqueado`) — Metas reusa essa separação em vez de inventar outra.

## O modelo

Duas tabelas, e a segunda existe pelo mesmo motivo que `pagamentos` e
`fixas_mes` existem: **ela não se deriva**.

### `metas`

| Coluna | Para quê |
|---|---|
| `nome` | como a pessoa chama |
| `valor_alvo` | quanto é preciso juntar |
| `prazo` | data opcional |
| `prioridade` | 1 a 3; ordena a lista e alimenta "meta em risco" |
| `cor`, `icone` | identidade visual |
| `status` | `ativa`, `concluida`, `arquivada` |
| `obs` | o resto |

**`reservado` NÃO é coluna.** Ele é a soma das alocações, e guardar uma soma que
se deriva é combinar de tê-la errada um dia.

### `alocacoes_de_meta`

Uma linha por vez em que a pessoa reservou (ou liberou) dinheiro para a meta.

| Coluna | Para quê |
|---|---|
| `meta_id` | de quem |
| `valor` | positivo reserva, **negativo libera** |
| `data` | quando |
| `obs` | por quê |

O valor com sinal é o que permite desfazer sem apagar histórico: liberar 200 é
uma linha de −200, não a exclusão de uma linha de +200. A pessoa consegue ler o
que aconteceu.

### O que NÃO existe, e é de propósito

- **Nenhuma ligação com `contas`.** A alocação não sai de uma conta específica;
  ela é sobre o total livre. Amarrar a uma conta pediria regra para
  transferência entre contas, e essa regra não foi desenhada.
- **Nenhuma transação.** Alocar não é movimento. Criar uma transação "falsa"
  para mover dinheiro para a meta é exatamente o defeito que este contrato
  proíbe: ela entraria no gasto do mês e no saldo da conta.
- **Nenhuma "meta paga sozinha".** Quando a viagem for comprada, isso é uma
  transação normal, como qualquer outra.

## A regra que o banco garante

**A soma das alocações de todas as metas nunca passa do saldo livre.**

Ela é cobrada por gatilho, e não por um `if` na tela, pela mesma razão de
sempre: a tela protege quem passa por ela.

> **O que isso NÃO garante:** que o saldo livre não caia depois. Se a pessoa
> reservou 5.000 e depois gastou, o reservado pode passar o saldo. Isso não é
> um erro do modelo — é a realidade, e a tela mostra como **meta em risco**, em
> vez de impedir um gasto que já aconteceu.

## Meta em risco

Uma meta está em risco quando:

- tem `prazo`, e
- o que falta dividido pelos meses restantes é **maior** do que a pessoa
  costuma sobrar por mês.

E há o caso mais simples: **o reservado total passou do saldo livre**. Aí todas
as metas estão em risco ao mesmo tempo, e a tela diz isso uma vez, não uma vez
por meta.

## Necessidade mensal

```
necessidade mensal = (valor_alvo − reservado) ÷ meses até o prazo
```

Sem prazo, não há necessidade mensal — e a tela mostra "sem prazo", não zero.
Zero diria "não precisa guardar nada", que é o oposto.

Meses até o prazo é **pelo menos 1**: uma meta que vence este mês precisa do
valor inteiro agora, não de uma divisão por zero.

## O que fica para depois

- **Alocação automática** (reservar X toda vez que entra salário). Precisa de
  regra de recorrência própria e de decidir o que fazer quando não há saldo.
- **Meta amarrada a uma conta específica** ("a poupança é da viagem"). Pede
  regra para transferência entre contas.
- **Concluir a meta e gastar de dentro dela.** Hoje o gasto é uma transação
  normal e a meta se conclui à mão. Ligar as duas coisas exige decidir se o
  gasto reduz o reservado, e essa decisão não foi tomada.
