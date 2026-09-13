/* O ESTADO DA V2 E QUEM O CARREGA.
 *
 * Um só lugar guarda o espelho do banco em memória, e um só lugar sabe
 * recarregá-lo. Toda tela lê daqui; nenhuma tela lê de outra tela.
 *
 * POR QUE O REGISTRO DE RECARGA EXISTE. `recarrega()` precisa redesenhar todas
 * as telas, e se ele as importasse uma a uma, cada tela importaria `recarrega`
 * de volta: ciclo. Em vez disso cada tela se INSCREVE, e o estado não conhece
 * nenhuma delas pelo nome. É o que permite acrescentar uma tela sem tocar aqui.
 *
 * O que mora aqui além do estado: os consultores por id. Eles são leitura de
 * estado, não desenho, e deixá-los na tela que por acaso os usou primeiro foi
 * o que criou dois ciclos na modularização (cartões precisava de fatura e
 * fatura precisava de cartões).
 */
import { midx, fromIdx, HOJE } from "../../core/dates.js";
import { listaDeOpcoes } from "./pecas.js";
import * as v2 from "../../data/v2-repository.js";

export const V2 = {
  instituicoes: [], contas: [], categorias: [], saldos: [], transacoes: [],
  /* os vínculos da ponte com a V1: qual compromisso, de qual competência, foi
     liquidado por qual transação */
  liquidacoes: [],
  /* faturas vêm da VIEW `faturas_resolvidas`, com total, pago e situação já
     derivados -- a tabela crua daria uma fatura sem número */
  cartoes: [], faturas: [], assinaturas: [],
  grupos: [], membros: [], despesas: [], saldosGrupo: [],
  mes: HOJE, carregado: false, erro: null, erroPonte: null,
};

export const dep = { toast: () => {}, erro: () => {} };

/* ------------------------------------------------------------------ carga --*/
export async function carregaV2(){
  const cad = await v2.carregaCadastrosV2();
  if (cad.erro){ V2.erro = cad.erro; return { erro: cad.erro }; }
  Object.assign(V2, cad.dados, { erro: null, carregado: true });
  const [t] = await Promise.all([
    carregaTransacoesDoMes(), carregaLiquidacoes(), carregaCartoesEFaturas(),
    carregaAssinaturas(), carregaGruposEsaldos()]);
  return t;
}

/* Sem filtro de competência, de propósito: a tela de Mês navega por qualquer
   mês e o Painel projeta doze. São poucas linhas -- uma por compromisso
   liquidado por mês -- e buscar por mês custaria uma ida ao banco a cada seta
   de navegação. Se um dia crescer, o filtro entra aqui e em lugar nenhum mais.

   Falhar aqui NÃO derruba a V2: guarda o erro e a tela some com os botões de
   pagar e receber. Mostrá-los sem saber o que já foi liquidado seria convidar
   a pagar duas vezes. */
export async function carregaLiquidacoes(){
  const r = await v2.listaLiquidacoes({});
  V2.erroPonte = r.erro || null;
  V2.liquidacoes = r.erro ? [] : (r.dados || []);
  if (r.erro) console.warn("ponte V1/V2 indisponível:", r.erro);
  return { erro: null };
}

/* Falhar aqui não derruba o resto: sem cartões, a tela de Cartões mostra o
   vazio e o resto do app segue igual. */
export async function carregaCartoesEFaturas(){
  const r = await v2.carregaCartoes();
  if (r.erro){ V2.cartoes = []; V2.faturas = []; console.warn("cartões indisponíveis:", r.erro); }
  else { V2.cartoes = r.dados.cartoes; V2.faturas = r.dados.faturas; }
  return { erro: null };
}

/* Materializa antes de listar. É seguro chamar a cada carga: a `unique` da 008
   garante que rodar duas vezes não duplica nada -- e sem essa garantia esta
   linha seria uma fábrica de duplicatas. */
export async function carregaAssinaturas(){
  await v2.materializaAssinaturas(null);
  const r = await v2.listaAssinaturas();
  if (r.erro){ V2.assinaturas = []; console.warn("assinaturas indisponíveis:", r.erro); }
  else V2.assinaturas = r.dados || [];
  return { erro: null };
}

export async function carregaGruposEsaldos(){
  const r = await v2.carregaGrupos();
  if (r.erro){
    V2.grupos = []; V2.membros = []; V2.despesas = []; V2.saldosGrupo = [];
    console.warn("grupos indisponíveis:", r.erro);
  } else {
    V2.grupos = r.dados.grupos; V2.membros = r.dados.membros;
    V2.despesas = r.dados.despesas; V2.saldosGrupo = r.dados.saldos;
  }
  return { erro: null };
}

export async function carregaTransacoesDoMes(){
  const i = midx(V2.mes);
  const r = await v2.listaTransacoes({ de: V2.mes + "-01", ate: fromIdx(i + 1) + "-01" });
  if (r.erro){ V2.erro = r.erro; return { erro: r.erro }; }
  V2.transacoes = r.dados || [];
  V2.erro = null;
  return { erro: null };
}


/* ------------------------------------------------ consultores de estado --
   Leitura por id. Moram aqui, e não na tela que por acaso os usou primeiro,
   porque foi isso que criou dois ciclos de import na modularização: cartões
   precisava de fatura e fatura precisava de cartões. */
export const contaPorId  = (id) => V2.contas.find((c) => c.id === id) || null;
export const instPorId   = (id) => V2.instituicoes.find((i) => i.id === id) || null;
export const cartaoPorId = (id) => V2.cartoes.find((c) => c.id === id) || null;
export const faturasDoCartao = (id) => V2.faturas.filter((f) => f.cartaoId === id);

/* A lista de contas de um <select>. Nasceu na tela de Transações e era
   importada pelo diálogo de transferência, que a tela de Transações importa de
   volta -- o segundo ciclo. Ela é leitura de estado, e o lugar dela é aqui. */
export const opcoesDeConta = (selecionado) =>
  listaDeOpcoes(V2.contas.filter((c) => c.ativo !== false)
    .map((c) => ({ id: c.id, rotulo: c.nome })), selecionado, "");

/* ---------------------------------------------------- recarga das telas --
   Cada tela se INSCREVE; o estado não conhece nenhuma pelo nome. É isto que
   deixa `recarrega()` redesenhar tudo sem importar tela nenhuma, e é isto que
   permite acrescentar uma tela sem tocar neste arquivo. */
const inscritos = [];
export const registraRecarga = (fn) => { inscritos.push(fn); };

export async function recarrega(){
  const r = await carregaV2();
  if (r && r.erro){ dep.erro("Não deu para atualizar. " + r.erro); return; }
  for (const fn of inscritos) fn();
  /* O Painel mora no `index.html` e lê V2: faturas a pagar, assinaturas do
     mês, o que o grupo te deve. Sem este aviso ele ficava com o número de
     antes até a próxima troca de mês -- um cartão recém-cadastrado não
     aparecia, e a tela mentia em silêncio. Foi o teste de navegador que pegou. */
  if (dep.aposRecarregar) dep.aposRecarregar();
}
