# Contrato de Competências da Regra

> O mês passou e a regra não rodou. O que o app faz com isso?

Escrito **antes** do código, como os outros quatro, porque a pergunta não é de
tela: é sobre o que o app tem o direito de fazer com o dinheiro de alguém sem
perguntar.

## A decisão, numa frase

**A competência atual roda sozinha. As passadas nunca rodam sozinhas.**

Uma regra de 500 por mês que ficou três meses sem rodar **não** reserva 1.500
quando a pessoa volta. Ela mostra três competências e espera.

O motivo é simples de enunciar e fácil de esquecer: consumir 1.500 da
disponibilidade de hoje por causa de meses que já passaram é tomar uma decisão
grande no lugar de quem ia tomá-la. O app pode adiantar o trabalho; não pode
adiantar a escolha.

## Os cinco nomes, que não são sinônimos

| Nome | O que é | Onde mora |
|---|---|---|
| **Regra** | "reservar até R$ X por mês" | `metas.regra_valor`, `metas.regra_ativa` |
| **Competência** | o mês a que a regra se refere, `AAAA-MM` | `alocacoes_de_meta.competencia` |
| **Alocação** | o valor efetivamente reservado | `alocacoes_de_meta.valor` |
| **Aplicação** | o instante real em que a reserva nasceu | `alocacoes_de_meta.criado_em` |
| **Pendência** | competência vencida, dentro da vigência, sem decisão | não existe em tabela nenhuma: é derivada |

**Competência não é data de aplicação**, e o app não finge que é:

```
competencia = 2026-01
criado_em   = 2026-03-12
```

lê-se *"a regra de janeiro foi regularizada em março"*. Nunca *"reservei em
janeiro"*. Uma reserva de janeiro feita em março é um ato de março, e o
histórico diz isso.

## O que é guardado, e o que continua derivado

Guardar estado é fácil e caro: cada coluna a mais é uma que pode discordar das
outras. A regra aqui é a de sempre — **guarda-se o que não se deriva**.

**Guardado**, quatro coisas:

| | Por que não se deriva |
|---|---|
| a alocação | já existia; é o dinheiro reservado |
| `alocacoes_de_meta.valor_planejado` | quanto a regra pedia **no instante da aplicação**; ver "A história não se reescreve" |
| a decisão de **ignorar** | ninguém deduz um "não quero" a partir da ausência de dados |
| `metas.regra_desde` | a primeira competência da vigência; ver "Começo e fim" |

**Derivado**, e por isso sem coluna:

| | Como se calcula |
|---|---|
| "aplicada" | existe alocação de regra naquela competência |
| "pendente" | a vigência cobre o mês, o mês não é futuro, não há alocação e não foi ignorada |
| "faltou" | `valor_planejado − valor alocado` |
| "sem disponibilidade" | é pendente **e** o disponível de agora é ≤ 0 |

### "Nunca avaliada" e "pendente" são o mesmo estado, de propósito

Dá para distinguir as duas guardando um carimbo de "passei por aqui e não deu".
Não vale a pena: **as duas pedem exatamente a mesma coisa da pessoa** — decidir.
Um estado a mais que não muda nenhuma ação é um estado que só pode discordar dos
outros.

O motivo de uma pendência não ter sido aplicada é informação útil, e por isso
aparece na tela; mas ele é lido do disponível **de agora**, não de um registro
do passado. Um "não tinha dinheiro em março" guardado envelheceria no minuto em
que o dinheiro entrasse.

## A competência atual

A cada abertura do app, depois de sessão válida e estado carregado, as regras
ativas são avaliadas **para o mês corrente e só para ele**.

Valem as regras da 016, inteiras:

```
regra 500, disponível 300  ->  reserva 300
regra 500, disponível 0    ->  NADA é criado
```

Zero não vira linha. Uma alocação de zero não é informação, é ruído.

### Disponível ≤ 0: fica PENDENTE, e tentar de novo é seguro

A competência atual sem disponibilidade **não** é dada por resolvida. Ela fica
pendente, porque dinheiro pode entrar no dia 20 e o mês ainda é o mesmo.

Tentar de novo a cada carga não é comportamento imprevisível, e a razão é
concreta: **quando não há disponível, nada acontece.** Nenhuma linha nasce,
nenhuma some, nada pisca na tela. A tentativa é idempotente e invisível. O que
seria imprevisível é gravar e apagar estado a cada carga — e é justamente isso
que não existe aqui.

Dito de outro modo: a automação da competência atual é uma função do
disponível, avaliada quando o app abre. Enquanto o mês não vira, a resposta
pode mudar porque o disponível mudou, e é isso que se quer.

## As competências passadas

Toda competência **anterior à atual**, dentro da vigência da regra e sem
decisão, é uma **pendência**.

Pendência não cria alocação. Nunca. Nem na abertura do app, nem em recarga, nem
em nenhum caminho que não passe por um clique de confirmação.

### Aplicar uma pendência usa o disponível de HOJE

Não existe "disponibilidade histórica". O dinheiro de janeiro não está guardado
em lugar nenhum esperando; o que existe é o que existe agora.

```
pendência de janeiro:  regra 500
disponível hoje:       300
--------------------------------
reserva efetiva:       300
competencia:           2026-01
criado_em:             hoje
```

E os 200 que faltaram **não viram promessa**: não há alocação parcial pendente,
não há fila, não há "devo 200 a janeiro". A competência fica aplicada com 300, e
o histórico mostra os três números.

### Ignorar

Decisão persistente, e as cinco consequências:

- não reaparece como pendente;
- não cria alocação;
- fica no histórico, marcada como ignorada, com a data da decisão;
- **não é apagada**;
- desfazer não existe nesta rodada.

Quando desfazer existir, será um ato explícito e um estado novo — nunca um
`delete` que finge que a pessoa nunca decidiu.

## A história não se reescreve

O caso que obriga a existir uma coluna:

```
janeiro:  regra 500, aplicou 300
março:    a pessoa muda a regra para 700
```

Se "planejado" fosse lido da regra de hoje, o histórico passaria a afirmar que
**janeiro planejava 700** — e que faltaram 400. Nada disso aconteceu.

Por isso `valor_planejado` é gravado **no instante da aplicação**, e é a única
coluna desta rodada que guarda um número que também existe em outro lugar. Ela
não é um cálculo guardado: é o **contexto de uma decisão**, que é um fato do
passado e não uma conta.

E a lição da 016 continua de pé: **"faltou" segue derivado**,
`valor_planejado − valor`, nunca uma coluna própria.

### Uma competência sem decisão não tem valor planejado

Enquanto janeiro é só uma pendência, ele **não** tem um valor congelado. A tela
mostra a regra de hoje, porque é a única regra que existe — nunca houve uma
decisão de janeiro para preservar.

Se a regra sobe de 500 para 700 com janeiro ainda pendente, janeiro passa a
mostrar 700. Isso não é reescrever história: é não inventar uma.

Congela no momento em que a decisão é tomada, e não antes.

## Começo e fim da regra

`metas.regra_desde` guarda a **primeira competência da vigência atual**, e é
gravada quando a regra é ligada.

- Regra criada em março **não** gera pendência de janeiro nem de fevereiro. O
  app não infere história anterior à existência da regra.
- Regra **desligada** não gera competência nenhuma — nem futura, nem pendência
  antiga. Desligar é dizer "pare de reservar todo mês", e continuar cobrando
  meses não decididos seria não obedecer.
- **Religar reinicia `regra_desde`.** A vigência é a atual, não a soma das
  anteriores. Quem desliga em abril e religa em junho não recebe abril e maio de
  volta: aqueles meses ficaram fora de qualquer vigência.

## A ordem, quando várias metas disputam o mesmo dinheiro

Nunca a ordem que o banco devolver. Sempre esta, e nesta sequência:

1. **prioridade** — a escala que já existe em Metas: 1 alta, 2 média, 3 baixa;
2. **prazo** mais próximo; sem prazo vai por último, porque não tem urgência;
3. **competência** mais antiga, quando se regularizam várias de uma vez;
4. **`criado_em`** e, empatando, **`id`** — desempate estável, para a mesma
   entrada dar sempre a mesma saída.

```
disponível 800
Meta A  prioridade alta   regra 500  ->  500
Meta B  prioridade média  regra 500  ->  300
```

B recebe 300, não 500, e não zero: o disponível é recalculado **depois de cada
meta**, em sequência. Multiplicar regra por número de metas não é simulação, é
chute.

O mesmo vale ao regularizar várias pendências de uma vez: a simulação mostrada
antes de confirmar é sequencial, e o total nunca passa do disponível.

## Concorrência

Duas abas abrem juntas. A garantia é do **banco**, nunca de um `if` de tela:

- o índice único parcial da 016 já impede duas alocações de regra para a mesma
  `(meta, competência)`;
- a automação roda dentro de uma função que toma um **lock por usuário**, então
  duas aberturas simultâneas viram duas execuções em fila, não duas
  concorrentes;
- decisão e alocação nascem na **mesma transação**. Ou as duas existem, ou
  nenhuma.

Se a execução falhar, a competência **não** é marcada como resolvida. Não há
meia operação para a próxima sessão encontrar.

## Sem agendador

A automação acontece quando a pessoa usa o app. Não há cron, nem Action, nem
Edge Function agendada — e não é limitação disfarçada: é o desenho. O app
registra as competências perdidas e as mostra quando ela voltar, que é
exatamente o que o Modelo C pede.

## O que uma pendência NÃO é

Esta seção existe porque a tentação é grande e o erro seria caro.

Pendência **não** é dívida, saldo, despesa, passivo nem valor reservado. Ela é
**a soma das regras que não rodaram** — um número de planejamento, não de
dinheiro.

Por isso:

- não entra em nenhum indicador financeiro;
- não entra no saldo, nem no projetado;
- não entra no calendário — nem atual, nem pendente, nem retroativa. O
  calendário é dinheiro entrando e saindo, e reserva de meta não é nem uma nem
  outra (`CONTRATO_SOBRA.md`, "O calendário NÃO mostra alocação de meta");
- quando aparece no Painel, aparece como **contagem de decisões esperando**, e
  nunca somada a um valor.

E o contrato de Metas continua inteiro por baixo de tudo isto: **meta é
envelope**. Aplicar uma competência não cria transação e não mexe em saldo de
conta.
