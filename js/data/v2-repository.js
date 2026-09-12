/* Acesso às tabelas da V2: instituições, contas, categorias, transações e a
 * view de saldo.
 *
 * O banco fala `snake_case` e o frontend fala `camelCase`. A tradução mora
 * aqui e em nenhum outro lugar -- é o motivo principal desta camada existir.
 * Ela é genérica de propósito: uma tabela de nomes por entidade envelheceria a
 * cada coluna nova, e a conversão `saldo_inicial_em` ↔ `saldoInicialEm` não
 * precisa de tabela nenhuma para ser feita certo.
 *
 * Nada aqui toca DOM, e nada aqui decide texto de tela. Toda função devolve
 * `{ dados, erro }`.
 */
import { conexao, executa } from "./client.js";

const sb = () => conexao.sb;

/* ------------------------------------------------------------- tradução --*/
export const paraCamel = (s) => String(s).replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
export const paraSnake = (s) => String(s).replace(/[A-Z]/g, (c) => "_" + c.toLowerCase());

/* `null` continua `null`, e array vira array. Data e número passam intactos:
   a conversão é só das CHAVES. */
export function doBanco(linha){
  if (linha == null) return linha;
  if (Array.isArray(linha)) return linha.map(doBanco);
  const saida = {};
  for (const k of Object.keys(linha)) saida[paraCamel(k)] = linha[k];
  return saida;
}

/* O caminho de volta ignora `undefined`: um formulário que não mexeu num campo
   não deve mandar `null` e apagar o que já estava lá. */
export function paraBanco(modelo){
  if (modelo == null) return modelo;
  if (Array.isArray(modelo)) return modelo.map(paraBanco);
  const saida = {};
  for (const k of Object.keys(modelo)){
    if (modelo[k] === undefined) continue;
    saida[paraSnake(k)] = modelo[k];
  }
  return saida;
}

/* embrulha `executa` convertendo o que vier */
async function consulta(promessa, contexto){
  const r = await executa(promessa, contexto);
  return r.erro ? r : { dados: doBanco(r.dados), erro: null };
}

/* --------------------------------------------------------------- carga --
   Instituições, contas, categorias e saldos vêm juntos: são poucas linhas e
   a tela de Contas precisa das quatro para desenhar uma linha sequer.
   Transações NÃO entram aqui -- elas crescem sem limite e são carregadas por
   mês, com filtro. */
export async function carregaCadastrosV2(){
  const c = sb();
  const [inst, ct, cat, sld] = await Promise.all([
    c.from("instituicoes").select("*").order("ordem").order("nome"),
    c.from("contas").select("*").order("ordem").order("nome"),
    c.from("categorias").select("*").order("nivel").order("ordem").order("nome"),
    c.from("saldos_de_conta").select("*"),
  ]);
  const falha = [inst, ct, cat, sld].find((r) => r.error);
  if (falha) return { dados: null, erro: falha.error.message };
  return {
    erro: null,
    dados: {
      instituicoes: doBanco(inst.data || []),
      contas: doBanco(ct.data || []),
      categorias: doBanco(cat.data || []),
      saldos: doBanco(sld.data || []),
    },
  };
}

/* --------------------------------------------------------- instituições --*/
export const salvaInstituicao = (modelo, id) => consulta(
  id ? sb().from("instituicoes").update(paraBanco(modelo)).eq("id", id)
     : sb().from("instituicoes").insert(paraBanco(modelo)), "instituição");
export const removeInstituicao = (id) =>
  consulta(sb().from("instituicoes").delete().eq("id", id), "instituição");

/* ---------------------------------------------------------------contas --*/
export const salvaConta = (modelo, id) => consulta(
  id ? sb().from("contas").update(paraBanco(modelo)).eq("id", id)
     : sb().from("contas").insert(paraBanco(modelo)), "conta");
export const removeConta = (id) =>
  consulta(sb().from("contas").delete().eq("id", id), "conta");

/* Quantas transações a conta tem. É o que decide entre desativar e excluir:
   conta com histórico não se apaga, se aposenta. */
export async function contaTemMovimento(contaId){
  const r = await executa(
    sb().from("transacoes").select("id", { count: "exact", head: true }).eq("conta_id", contaId),
    "conta");
  return r;
}

/* ----------------------------------------------------------- categorias --*/
export const salvaCategoria = (modelo, id) => consulta(
  id ? sb().from("categorias").update(paraBanco(modelo)).eq("id", id)
     : sb().from("categorias").insert(paraBanco(modelo)), "categoria");
export const removeCategoria = (id) =>
  consulta(sb().from("categorias").delete().eq("id", id), "categoria");
/* o insert em lote das categorias padrão: uma chamada, não vinte */
export const criaCategorias = (lista) =>
  consulta(sb().from("categorias").insert(paraBanco(lista)).select("*"), "categorias");

/* ----------------------------------------------------------- transações --
   Sempre por período. `ate` é exclusivo -- passar o primeiro dia do mês
   seguinte evita ter de saber quantos dias o mês tem. */
export function listaTransacoes({ de, ate, contaId, categoriaId, tipo, status } = {}){
  let q = sb().from("transacoes").select("*");
  if (de)  q = q.gte("data", de);
  if (ate) q = q.lt("data", ate);
  if (contaId)     q = q.eq("conta_id", contaId);
  if (categoriaId) q = q.eq("categoria_id", categoriaId);
  if (tipo)        q = q.eq("tipo", tipo);
  if (status)      q = q.eq("status", status);
  return consulta(q.order("data", { ascending: false }).order("criado_em", { ascending: false }), "transações");
}

export const salvaTransacao = (modelo, id) => consulta(
  id ? sb().from("transacoes").update(paraBanco(modelo)).eq("id", id)
     : sb().from("transacoes").insert(paraBanco(modelo)), "transação");
export const removeTransacao = (id) =>
  consulta(sb().from("transacoes").delete().eq("id", id), "transação");

/* ---------------------------------------------------------- transferência --
   As duas pernas precisam nascer e morrer JUNTAS, e duas chamadas HTTP
   independentes não dão essa garantia: a segunda pode falhar e deixar meia
   transferência no banco. Por isso vai por RPC, que roda tudo numa transação
   só do lado do Postgres. Ver `supabase/migrations/004_...`. */
export const criaTransferencia = (p) => consulta(
  sb().rpc("cria_transferencia", {
    p_conta_origem:  p.contaOrigemId,
    p_conta_destino: p.contaDestinoId,
    p_valor:         p.valor,
    p_data:          p.data,
    p_descricao:     p.descricao || "Transferência",
    p_obs:           p.obs || "",
    p_status:        p.status || "realizada",
  }), "transferência");

export const atualizaTransferencia = (p) => consulta(
  sb().rpc("atualiza_transferencia", {
    p_transferencia: p.transferenciaId,
    p_conta_origem:  p.contaOrigemId,
    p_conta_destino: p.contaDestinoId,
    p_valor:         p.valor,
    p_data:          p.data,
    p_descricao:     p.descricao || "Transferência",
    p_obs:           p.obs || "",
    p_status:        p.status || "realizada",
  }), "transferência");

export const removeTransferencia = (transferenciaId) => consulta(
  sb().rpc("remove_transferencia", { p_transferencia: transferenciaId }), "transferência");
