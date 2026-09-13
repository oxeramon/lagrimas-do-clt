/* Grupos, rateios e acertos.
 *
 *     GRUPO calcula OBRIGAÇÃO.     "Carlos te deve R$ 100"
 *     TRANSAÇÃO calcula DINHEIRO.  "Carlos pagou R$ 100 na sua conta"
 *
 * As duas se relacionam e não são a mesma coisa. Este módulo só fala da
 * primeira. Quem liga as duas é a pessoa, escolhendo a conta na hora do
 * acerto -- nunca o app por conta própria.
 *
 * A divisão em centavos existe aqui E no banco, pela mesma razão da regra do
 * ciclo do cartão: a tela precisa mostrar "R$ 33,34 para você e R$ 33,33 para
 * cada um" antes de gravar. Quem RECUSA uma divisão que não fecha é o gatilho
 * postergado da 009, e ele não pode ser contornado.
 *
 * Nada aqui toca DOM nem banco.
 */

/* -------------------------------------------------------- divisão igual --
   100 em três não divide. Os centavos que sobram vão para os PRIMEIROS da
   lista, um para cada, e a soma é exatamente o total -- sempre.

   Espalhar de um em um, e não jogar tudo na primeira pessoa, é o que evita
   alguém pagar três centavos a mais que os outros numa divisão por dez. */
export function divisaoIgual(valorTotal, quantos){
  const total = Math.round((Number(valorTotal) || 0) * 100);
  const n = Math.max(1, Number(quantos) || 1);
  const base = Math.floor(total / n);
  const sobra = total - base * n;
  return Array.from({ length: n }, (_, i) => (base + (i < sobra ? 1 : 0)) / 100);
}

/* Quanto falta para a divisão personalizada fechar. Zero é o único valor
   aceitável, e a tela mostra este número enquanto a pessoa digita -- em vez de
   deixá-la descobrir na recusa. */
export function faltaFechar(valorTotal, partes){
  const total = Math.round((Number(valorTotal) || 0) * 100);
  const somado = (partes || []).reduce((s, v) => s + Math.round((Number(v) || 0) * 100), 0);
  return (total - somado) / 100;
}
export const fecha = (valorTotal, partes) => faltaFechar(valorTotal, partes) === 0;

/* -------------------------------------------------------------- saldos --
   A view `saldos_do_grupo` já entrega o saldo de cada membro. O que falta é a
   leitura: positivo tem a receber, negativo deve, e a soma de todos é zero.
   Se ela não for zero, alguma coisa está errada -- e a tela precisa saber
   disso em vez de mostrar um número torto com cara de certo. */
export const temAReceber = (m) => Number(m.saldo) > 0;
export const deve         = (m) => Number(m.saldo) < 0;
export const quite        = (m) => Number(m.saldo) === 0;

const centavos = (v) => Math.round(v * 100) / 100;

export function contaFecha(saldos){
  return centavos((saldos || []).reduce((s, m) => s + (Number(m.saldo) || 0), 0)) === 0;
}

/* O meu saldo no grupo. `null` quando nenhum membro está marcado como eu --
   e `null` não é zero: um diz "não sei", o outro diz "estamos quites". */
export function meuSaldo(saldos){
  const eu = (saldos || []).find((m) => m.souEu);
  return eu ? Number(eu.saldo) : null;
}

/* ----------------------------------------------------- quem paga a quem --
   O grupo sabe quanto cada um deve no total, e isso não é o mesmo que saber
   quem deve a quem. Este é o algoritmo guloso clássico: o mais endividado
   paga ao mais credor, até zerar.

   Ele NÃO é o mínimo de transferências possível -- esse problema é NP-difícil
   e a diferença, num grupo de amigos, é de uma transferência. O que ele é:
   determinístico, explicável e sempre correto na soma. */
export function acertosSugeridos(saldos){
  const devedores = (saldos || []).filter(deve)
    .map((m) => ({ id: m.membroId, nome: m.nome, falta: -Number(m.saldo) }))
    .sort((a, b) => b.falta - a.falta);
  const credores = (saldos || []).filter(temAReceber)
    .map((m) => ({ id: m.membroId, nome: m.nome, falta: Number(m.saldo) }))
    .sort((a, b) => b.falta - a.falta);

  const fora = [];
  let i = 0, j = 0;
  /* o laço avança sempre que um dos dois zera, então ele termina: cada volta
     fecha pelo menos um lado */
  while (i < devedores.length && j < credores.length){
    const quanto = centavos(Math.min(devedores[i].falta, credores[j].falta));
    if (quanto > 0){
      fora.push({ deId: devedores[i].id, deNome: devedores[i].nome,
                  paraId: credores[j].id, paraNome: credores[j].nome, valor: quanto });
      devedores[i].falta = centavos(devedores[i].falta - quanto);
      credores[j].falta  = centavos(credores[j].falta - quanto);
    }
    if (devedores[i].falta <= 0) i += 1;
    if (credores[j].falta  <= 0) j += 1;
  }
  return fora;
}

/* ---------------------------------------------------------- indicadores --*/
export function indicadoresDoGrupo(saldos, despesas){
  const meu = meuSaldo(saldos);
  return {
    membros: (saldos || []).length,
    gastoTotal: centavos((despesas || []).reduce((s, d) => s + (Number(d.valor) || 0), 0)),
    despesas: (despesas || []).length,
    meuSaldo: meu,
    /* separados de propósito: "a receber" e "a pagar" não se somam num número
       só, e um saldo líquido esconderia que você deve a um e recebe de outro */
    aReceber: centavos((saldos || []).filter(temAReceber)
      .reduce((s, m) => s + Number(m.saldo), 0)),
    fecha: contaFecha(saldos),
  };
}
