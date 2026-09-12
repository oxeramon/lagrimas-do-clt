/* Receitas: o que entra além da renda base.
 *
 * Como nas parcelas, o mês é derivado do intervalo, não armazenado. Uma
 * receita mensal sem mês inicial vale desde sempre; sem mês final, para sempre.
 * Uma pontual vale no mês exato e em nenhum outro.
 *
 * Lê `S`. Não escreve, não toca DOM.
 */
import { S } from "../core/state.js";
import { midx, label, HOJE } from "../core/dates.js";

export function aplicaEm(r, k){
  if (r.tipo === "pontual") return r.mesInicial === k;
  if (r.mesInicial && midx(k) < midx(r.mesInicial)) return false;
  if (r.mesFinal   && midx(k) > midx(r.mesFinal))   return false;
  return true;
}

export const receitasDoMes = k => S.receitas.filter(r => aplicaEm(r, k));
export const totalReceitas = k => receitasDoMes(k).reduce((s,r) => s + r.valor, 0);
export const rendaDoMes    = k => S.renda + totalReceitas(k);

/* Os cinco formatos de intervalo, nomeados. */
export function periodoReceita(r){
  if (r.tipo === "pontual")           return label(r.mesInicial);
  if (!r.mesInicial && !r.mesFinal)   return "sem prazo";
  if (r.mesInicial && !r.mesFinal)    return "desde " + label(r.mesInicial);
  if (!r.mesInicial && r.mesFinal)    return "até " + label(r.mesFinal);
  return label(r.mesInicial) + "–" + label(r.mesFinal);
}

/* Quanto de uma receita mensal com começo e fim já passou. Só faz sentido
   quando os dois existem: sem eles não há janela para medir. */
export function janelaDe(r){
  if (r.tipo !== "mensal" || !r.mesInicial || !r.mesFinal) return null;
  const total = midx(r.mesFinal) - midx(r.mesInicial) + 1;
  const decorridos = Math.min(total, Math.max(0, midx(HOJE) - midx(r.mesInicial) + 1));
  return { decorridos, total, frac: total ? decorridos / total : 0, bruto: r.valor * total };
}

/* Onde uma receita pontual está em relação a hoje. */
export function estadoDe(r){
  if (r.tipo !== "pontual") return null;
  const d = midx(r.mesInicial) - midx(HOJE);
  return d < 0 ? "já entrou" : d === 0 ? "entra este mês" : "entra em " + label(r.mesInicial);
}
