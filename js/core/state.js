/* O espelho do banco em memória.
 *
 * `S` é estado compartilhado de propósito: o app inteiro lê daqui, e quem
 * escreve é só a camada de dados, depois de uma consulta bem-sucedida. Não é
 * um "store" com ambição de framework -- é o resultado da última carga, e a
 * regra que o mantém honesto é a da carga ser tudo-ou-nada: ou `S` reflete o
 * banco, ou o app diz que não conseguiu carregar. Nunca meio caminho.
 *
 * Módulo de domínio pode LER `S`. Só `data/` escreve.
 */
export const S = {
  dividas: [], fixas: [], credores: [], receitas: [], renda: 0, pagos: {},
  mes: null, loaded: false, mesFixado: false, uid: null, erroCarga: null,
  fixasMes: {},
};

/* Substitui o conteúdo de S sem trocar a referência, para quem já importou o
   objeto continuar enxergando o mesmo. Existe para a camada de dados aplicar
   uma carga inteira de uma vez, e para o teste montar um cenário. */
export function aplicaEstado(novo){
  Object.assign(S, novo);
  return S;
}
