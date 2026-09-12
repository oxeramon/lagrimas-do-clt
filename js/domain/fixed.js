/* Contas fixas: despesa recorrente sem prazo de fim.
 *
 * `fixas.valor` é o valor do cadastro. Quando a conta é marcada como variável,
 * ele passa a ser a MÉDIA: um palpite para os meses que ainda não chegaram.
 * O real de um mês mora em `fixas_mes`, que é a segunda e última tabela por mês
 * deste banco -- e existe pelo mesmo motivo de `pagamentos`: não se deriva. A
 * conta de luz de outubro não sai de nenhuma conta, ela chega.
 *
 * O contrato que mais importa aqui: informar outubro não reescreve setembro
 * nem muda o palpite de novembro.
 *
 * Lê `S`. Não escreve, não toca DOM.
 */
import { S } from "../core/state.js";

/* Quanto a conta fixa vale num mês. Aluguel responde o mesmo sempre; energia
   responde a média até a fatura chegar, e o valor real depois disso. */
export const valorFixa = (f, k) => {
  const real = (S.fixasMes[k] || {})[f.id];
  return real === undefined ? (Number(f.valor) || 0) : real;
};

/* Zero informado é informação, não ausência: conta variável pode vir zerada, e
   aí o app mostra zero em vez de voltar para a média. Por isso a comparação é
   com `undefined`, e não por veracidade. */
export const informado = (f, k) => (S.fixasMes[k] || {})[f.id] !== undefined;

/* quanto do mês ainda é palpite: entra na frase da sobra, que sem isso promete
   uma precisão que não tem */
export const fixasEstimadas = (k) => S.fixas
  .filter(f => f.variavel && !informado(f, k))
  .reduce((s,f) => s + (Number(f.valor)||0), 0);

export const totalFixas = (k) => S.fixas.reduce((s,f) => s + valorFixa(f, k), 0);
