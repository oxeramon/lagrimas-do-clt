/* Mês e data.
 *
 * O mês é uma string "AAAA-MM" e a aritmética passa por um índice inteiro
 * (`midx`), nunca por `Date`. Isso é deliberado: somar mês com Date esbarra em
 * fim de mês e em fuso, e aqui mês é uma posição numa régua, não um instante.
 *
 * Funções puras. Não conhecem dívida, conta nem tela.
 */

export const MESES_PT = ["jan","fev","mar","abr","mai","jun","jul","ago","set","out","nov","dez"];
export const MES_LONGO = ["janeiro","fevereiro","março","abril","maio","junho",
  "julho","agosto","setembro","outubro","novembro","dezembro"];
export const DIA_SEM = ["dom","seg","ter","qua","qui","sex","sáb"];

export const mkey    = d => d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0");
export const midx    = k => { const p = k.split("-"); return (+p[0])*12 + (+p[1]) - 1; };
export const fromIdx = i => Math.floor(i/12) + "-" + String(i%12+1).padStart(2,"0");
export const addM    = (k,n) => fromIdx(midx(k)+n);
export const label   = k => { const p = k.split("-"); return MESES_PT[(+p[1])-1] + "/" + p[0].slice(2); };
export const labelLong = k => { const p = k.split("-"); return MESES_PT[(+p[1])-1] + "/" + p[0]; };

/* O mês corrente, fixado quando o módulo carrega. */
export const HOJE = mkey(new Date());

/* AAAA-MM-DD a partir de um Date local. */
export const iso = d => d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0")
  + "-" + String(d.getDate()).padStart(2,"0");

/* A data vem como 2026-03-07; montar com os números evita o fuso empurrar para
   o dia anterior, que `new Date("2026-03-07")` faria em UTC-3 por ler a forma
   como UTC. */
export function dataLocal(isoStr){
  const p = String(isoStr).split("-");
  return new Date(+p[0], +p[1] - 1, +p[2]);
}

/* Em qual das quatro semanas do mês um dia cai. A última recebe o resto, para
   dia 29, 30 e 31 não criarem uma quinta barra de um dia só. */
export const semanaDoMes = dia => Math.min(3, Math.floor((dia - 1) / 7));
