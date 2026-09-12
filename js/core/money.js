/* Dinheiro: formatação e o piso do que conta como valor.
 *
 * Funções puras. Não conhecem dívida, conta nem tela.
 */

const BRL = new Intl.NumberFormat("pt-BR", { style:"currency", currency:"BRL" });

/* Já traz o "R$": não ponha outro na frente. */
export const money = v => BRL.format(Number(v) || 0);

export const pct = v => (Number(v)*100).toFixed(1).replace(".", ",") + "%";

/* figura de destaque: centavos recuam para o número cheio ser lido de longe */
export const moneyRico = v => money(v).replace(/(,\d{2})$/, '<span class="cents">$1</span>');

/* rótulo curto de eixo: 12.500 -> 12,5k */
export function curto(v){
  const a = Math.abs(v);
  if (a >= 1000) return (v/1000).toFixed(a >= 10000 ? 0 : 1).replace(".", ",").replace(",0", "") + "k";
  return String(Math.round(v));
}

/* Menos que meio centavo é ruído de ponto flutuante, não dinheiro. Subtrair
   somas de centavos deixa resíduo de 1e-15, e um `> 0` ingênuo imprimia
   "R$ 0,00 em compras do mês" para uma fatura sem compras do mês. */
export const temValor = v => Math.abs(v) >= 0.005;
