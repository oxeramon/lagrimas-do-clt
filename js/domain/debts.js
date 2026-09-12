/* Dívidas: o cálculo de parcela, saldo e prazo.
 *
 * O modelo central do app: uma dívida é um INTERVALO, não uma coleção de
 * linhas. A parcela de um mês existe se o mês cai entre `mesInicial` e
 * `mesInicial + (totalParcelas − parcelaInicial)`. Corrigir um valor corrige o
 * histórico inteiro de uma vez, porque não há histórico duplicado.
 *
 * Lê `S`. Não escreve, não toca DOM.
 */
import { S } from "../core/state.js";
import { midx, addM, HOJE } from "../core/dates.js";

export const restantesDe = d => (d.totalParcelas - d.parcelaInicial) + 1;
export const ultimoMes   = d => addM(d.mesInicial, restantesDe(d) - 1);

/* A parcela que cai no mês k, ou null. O número mostrado é
   `parcelaInicial + i`, e não `i + 1`: quem entra na 13 continua vendo 13. */
export function parcelaEm(d, k){
  const i = midx(k) - midx(d.mesInicial);
  if (i < 0 || i >= restantesDe(d)) return null;
  return { n: d.parcelaInicial + i, total: d.totalParcelas, valor: d.valor };
}

export const pagoId = (mes, id) => (S.pagos[mes] || {})[id] === true;

export function dividasDoMes(k){
  return S.dividas
    .map(d => ({ d, p: parcelaEm(d, k) }))
    .filter(x => x.p)
    .sort((a,b) => (a.d.ordem||0) - (b.d.ordem||0));
}
export const totalDividas = k => dividasDoMes(k).reduce((s,x) => s + x.p.valor, 0);

export function saldoAberto(filtro){
  let t = 0;
  for (const d of S.dividas){
    if (filtro && !filtro(d)) continue;
    for (let i = 0; i < restantesDe(d); i++){
      if (!pagoId(addM(d.mesInicial, i), d.id)) t += d.valor;
    }
  }
  return t;
}

/* saldo que a dívida ainda tem em aberto, já descontando o que foi pago */
export function abertoDe(d){
  let t = 0;
  for (let i = 0; i < restantesDe(d); i++)
    if (!pagoId(addM(d.mesInicial, i), d.id)) t += d.valor;
  return t;
}

/* o que já foi pago. Soma mês a mês de propósito, igual a saldoAberto():
   calcular isto como (valor × parcelas) − aberto misturava multiplicação
   com soma repetida e sobrava um resto negativo de ponto flutuante, que
   o formatador exibia como "-R$ 0,00". */
/* Duas origens, os dois pagamentos de verdade.

   As parcelas anteriores à parcela inicial foram pagas antes de a dívida
   entrar aqui: não têm marca em `pagamentos` porque o app não existia para
   elas, mas saíram do bolso do mesmo jeito. Contar só as marcadas dizia
   "R$ 0,00 já quitados" para quem tinha pago um ano de financiamento -- e
   ainda desmentia o cartão da dívida, que sempre contou as duas.

   A identidade contratado = aberto + quitado continua exata, sem subtração:
   (total - pi + 1 - marcadas) + (pi - 1 + marcadas) = total. */
export function totalQuitado(){
  let t = 0;
  for (const d of S.dividas){
    t += (d.parcelaInicial - 1) * d.valor;
    for (let i = 0; i < restantesDe(d); i++)
      if (pagoId(addM(d.mesInicial, i), d.id)) t += d.valor;
  }
  return t;
}

/* soma o que está em aberto agrupando por uma chave qualquer, maior primeiro */
export function agrupaAberto(chave){
  const m = new Map();
  for (const d of S.dividas){
    const v = abertoDe(d);
    if (v <= 0) continue;
    const c = chave(d) || "—";
    m.set(c, (m.get(c) || 0) + v);
  }
  return [...m.entries()].map(([nome, v]) => ({ nome, v })).sort((a,b) => b.v - a.v);
}

/* o filtro opcional deixa a aba Dívidas reescopar tudo por credor sem
   duplicar a regra de negócio */
export function parcelasAVencer(filtro){
  let n = 0;
  for (const d of S.dividas){
    if (filtro && !filtro(d)) continue;
    for (let i = 0; i < restantesDe(d); i++)
      if (!pagoId(addM(d.mesInicial, i), d.id)) n++;
  }
  return n;
}

export function fimGeral(filtro){
  let max = null;
  for (const d of S.dividas){
    if (filtro && !filtro(d)) continue;
    const u = ultimoMes(d);
    if (max === null || midx(u) > midx(max)) max = u;
  }
  return max;
}

/* Quanto ainda se deve depois do mês k. Era a única soma de saldo do arquivo
   que não olhava `pagamentos`, e isso dava uma curva de quitação em que o
   primeiro ponto (que vem de saldoAberto) descontava o já pago e todos os
   outros não -- adiantar uma parcela não fazia a curva descer. */
export function saldoAposMes(k, filtro){
  let t = 0;
  for (const d of S.dividas){
    if (filtro && !filtro(d)) continue;
    for (let i = 0; i < restantesDe(d); i++){
      const m = addM(d.mesInicial, i);
      if (midx(m) > midx(k) && !pagoId(m, d.id)) t += d.valor;
    }
  }
  return t;
}

export function escolheMesInicial(){
  if (dividasDoMes(HOJE).length) return HOJE;
  let prox = null;
  for (const d of S.dividas)
    for (let i = 0; i < restantesDe(d); i++){
      const k = addM(d.mesInicial, i);
      if (midx(k) >= midx(HOJE) && (prox === null || midx(k) < midx(prox))) prox = k;
    }
  return prox || HOJE;
}

/* quanto da dívida já foi quitado. parcelaInicial - 1 são as parcelas pagas
   antes do app existir; as marcadas em pagamentos somam por cima. */
export function progressoDe(d){
  let marcadas = 0;
  for (let i = 0; i < restantesDe(d); i++)
    if (pagoId(addM(d.mesInicial, i), d.id)) marcadas++;
  const quitadas = Math.min(d.totalParcelas, (d.parcelaInicial - 1) + marcadas);
  return { quitadas, total: d.totalParcelas, frac: d.totalParcelas ? quitadas / d.totalParcelas : 0 };
}

/* Financiamento e empréstimo são MEIOS, nunca categorias -- a lista de
   categorias vai de Transporte a Outros e não tem nenhum dos dois. O filtro
   "sem financiamento" já comparou com `d.categoria`, e aí a condição era
   sempre verdadeira e ele não excluía nada: o indicador mostrava o mesmo
   número do saldo total. Sobra de quando credor, meio e categoria ainda
   viviam espremidos num campo só. */
export const COM_JUROS = ["Financiamento", "Empréstimo"];
export const temJuros  = d => COM_JUROS.includes(d.meio);

/* Quanto de uma dívida é seu, depois do que outra pessoa devolve. O rateio é
   por parcela, igual a `valor`: numa compra de 4x R$ 88 rachada ao meio, são
   R$ 44 por mês que voltam. `valor` não muda -- você deve a parcela cheia ao
   credor, e o acerto é com a pessoa. */
export const meuDe = d => d.valor - (d.valorTerceiro || 0);
