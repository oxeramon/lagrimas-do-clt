/* Credores: quem se deve, e a hierarquia de dois níveis.
 *
 * Um banco é o credor; o cartão é produto dele. Quase toda tela quer os dois:
 * agrupa pelo banco, detalha pelo produto. São dois níveis e só -- quem tem pai
 * não pode ser pai de ninguém, o que a tela garante ao oferecer só credores de
 * primeiro nível como pai, e o banco reforça com `credores_pai_nao_e_si`.
 *
 * Lê `S`. Não escreve, não toca DOM.
 */
import { S } from "../core/state.js";

/* Casa pelo id; o nome é a ponte para linha antiga, de antes de `credor_id`
   existir, que continua preenchida e por isso nada quebrou na migração. */
export const credorDe = d => S.credores.find(c => c.id === d.credorId)
                          || S.credores.find(c => c.nome === d.credor) || null;

export const paiDe    = c => (c && c.paiId) ? (S.credores.find(x => x.id === c.paiId) || null) : null;
export const raizDe   = c => paiDe(c) || c || null;
export const filhosDe = c => S.credores.filter(x => x.paiId === c.id);

/* Quem dividiu a conta com você. É um credor como outro qualquer: a pessoa a
   quem se deve e a pessoa que te deve moram na mesma tabela. */
export const pessoaDe   = d => S.credores.find(c => c.id === d.pessoaId) || null;
export const nomePessoa = d => (pessoaDe(d) || {}).nome || "";

/* O nome do produto e o nome do banco. Filtrar pelo banco pega tudo dele;
   pelo produto, só aquela fatura. */
export const nomeCredorDe = d => (credorDe(d) || {}).nome || d.credor;
export const nomeBancoDe  = d => (raizDe(credorDe(d)) || {}).nome || d.credor;

/* Busca por nome, sem diferenciar maiúscula nem espaço nas pontas. Usada
   quando a pessoa digita um credor no formulário em vez de escolher da lista.
   Devolve `undefined` quando não acha, como todo `find` -- quem chama trata. */
export const credorPorNome = nome => S.credores.find(c =>
  c.nome.trim().toLowerCase() === String(nome).trim().toLowerCase());
