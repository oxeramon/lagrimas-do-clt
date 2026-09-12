/* Fatura de cartão: em qual mês uma compra vai ser paga.
 *
 * Função pura: recebe a data da compra e o ciclo do cartão, devolve o mês da
 * fatura. Não lê `S` nem toca DOM -- é a regra sozinha, e por isso é a mais
 * fácil de testar do projeto.
 *
 * A compra entra na fatura que fecha depois dela; essa fatura é paga no mês
 * seguinte ao fechamento quando o vencimento vem ANTES do fechamento (fecha 25,
 * vence 8), e no mesmo mês quando vem depois (fecha 10, vence 20).
 *
 * A comparação é `>=` e não `>`: compra feita no próprio dia do fechamento já
 * cai na fatura seguinte, porque o extrato é cortado naquele dia. Com `>`, ela
 * cairia um mês antes do que o extrato do cartão cobra.
 *
 * Sem dia de fechamento não há fatura a deduzir, e a resposta é `null` -- é o
 * caso de credor que não é cartão.
 */
import { midx, fromIdx } from "../core/dates.js";

export function faturaDaCompra(iso, fecha, vence){
  if (!iso || !fecha) return null;
  const p = String(iso).split("-");
  let mesFecha = midx(p[0] + "-" + p[1]);
  if (+p[2] >= fecha) mesFecha += 1;
  return fromIdx(mesFecha + ((vence && vence > fecha) ? 0 : 1));
}
