/* Assinaturas: a regra, e nunca a ocorrência.
 *
 *     Assinatura é REGRA.     "R$ 19,90 todo mês, desde março"
 *     Ocorrência é EVENTO.    "R$ 19,90 saíram em 05/09"
 *
 * Este módulo só fala de regra. A ocorrência é uma transação prevista, mora em
 * `transacoes`, e quem soma transação é `transactions.js`. Somar as duas
 * contaria o mesmo dinheiro duas vezes -- é o mesmo erro que a ponte da 005
 * resolveu do outro lado.
 *
 * `custoMensal` e `custoAnual` também vêm prontos da view `assinaturas_
 * resolvidas`. As funções daqui existem para a tela poder mostrar o
 * equivalente ENQUANTO a pessoa digita o valor, antes de salvar. Os mesmos
 * casos rodam nos dois lados em testes/regras.mjs e no 008.
 *
 * Nada aqui toca DOM nem banco.
 */

export const FREQUENCIAS = [
  { id: "semanal",    rotulo: "Toda semana",   porAno: 52 },
  { id: "mensal",     rotulo: "Todo mês",      porAno: 12 },
  { id: "bimestral",  rotulo: "A cada 2 meses", porAno: 6 },
  { id: "trimestral", rotulo: "A cada 3 meses", porAno: 4 },
  { id: "semestral",  rotulo: "A cada 6 meses", porAno: 2 },
  { id: "anual",      rotulo: "Uma vez por ano", porAno: 1 },
];

/* TODA frequência vira ocorrência desde a 011, semanal inclusive.

   Esta lista já teve `"semanal"` dentro, e a razão era do MODELO, não da tela:
   a 008 identificava a ocorrência por `(assinatura, competência)`, e quatro
   cobranças semanais no mesmo mês não cabem numa chave por mês. A 011 trocou a
   identidade para a DATA da ocorrência, e a exceção deixou de existir.

   A lista fica, vazia e exportada, por dois motivos. A pergunta continua
   legítima -- se um dia entrar uma frequência que o banco não saiba
   materializar, ela tem lugar. E a tela ainda pergunta: uma lista vazia
   responde "todas materializam" sem espalhar um `if` por dois arquivos. */
export const SEM_MATERIALIZACAO = [];
export const materializa = (frequencia) => !SEM_MATERIALIZACAO.includes(frequencia);

const porAnoDe = (frequencia) =>
  (FREQUENCIAS.find((f) => f.id === frequencia) || { porAno: 12 }).porAno;

export const rotuloDaFrequencia = (id) =>
  (FREQUENCIAS.find((f) => f.id === id) || { rotulo: id }).rotulo;

/* Os dois equivalentes. São o que permite comparar uma assinatura anual com
   uma mensal sem fazer a conta de cabeça -- e comparar é a única razão pela
   qual alguém abre esta tela. */
const cent = (v) => Math.round(v * 100) / 100;
export const custoAnual  = (valor, frequencia) => cent((Number(valor) || 0) * porAnoDe(frequencia));
export const custoMensal = (valor, frequencia) => cent(custoAnual(valor, frequencia) / 12);

/* --------------------------------------------------------- indicadores --
   O que o topo da tela mostra. Assinatura desligada fica fora de tudo: ela é
   histórico, não custo de hoje. */
export function indicadoresDeAssinaturas(lista, hojeISO){
  const ativas = (lista || []).filter((a) => a.ativo !== false && !venceu(a, hojeISO));
  const mensal = ativas.reduce((s, a) => s + custoMensal(a.valor, a.frequencia), 0);
  /* A maior pela mesma régua de todas: comparar R$ 120 por ano com R$ 30 por
     mês pelo valor cru diria que a anual é a maior, e ela não é. */
  const maior = ativas.reduce((m, a) =>
    (m === null || custoMensal(a.valor, a.frequencia) > custoMensal(m.valor, m.frequencia)) ? a : m, null);
  return {
    quantidade: ativas.length,
    inativas: (lista || []).length - ativas.length,
    mensal: cent(mensal),
    anual: cent(mensal * 12),
    maior,
  };
}

/* Assinatura com data de fim já passada conta como encerrada mesmo sem ninguém
   ter desligado o botão. É o estado real, e ignorá-lo inflaria o custo. */
export const venceu = (a, hojeISO) => !!a.fim && String(a.fim) < String(hojeISO);

/* A próxima cobrança vem da view, que a deriva das ocorrências previstas.
   `null` quando não há nenhuma -- e `null` NÃO é "hoje". */
export function proximasCobrancas(lista, hojeISO, quantas = 3){
  return (lista || [])
    .filter((a) => a.ativo !== false && a.proximaCobranca
                   && String(a.proximaCobranca) >= String(hojeISO))
    .sort((a, b) => String(a.proximaCobranca).localeCompare(String(b.proximaCobranca)))
    .slice(0, quantas);
}

/* Onde ela é cobrada, em uma palavra. "Ainda não escolhido" é um estado real,
   e não um erro -- forçar a escolha produziria dado errado. */
export function meioDaAssinatura(a, contas, cartoes){
  if (a.contaId){
    const c = (contas || []).find((x) => x.id === a.contaId);
    return { onde: "conta", rotulo: c ? c.nome : "Conta" };
  }
  if (a.cartaoId){
    const k = (cartoes || []).find((x) => x.id === a.cartaoId);
    return { onde: "cartao", rotulo: k ? k.nome : "Cartão" };
  }
  return { onde: null, rotulo: "Ainda não escolhido" };
}
