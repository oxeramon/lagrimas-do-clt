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
import { conexao, executa, erroLegivel } from "./client.js";

/* nome privado e distinto por arquivo: a prévia achata todos os módulos
   num escopo só, e dois `const sb` colidiriam. */
const bancoV2 = () => conexao.sb;

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
  const c = bancoV2();
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
  id ? bancoV2().from("instituicoes").update(paraBanco(modelo)).eq("id", id)
     : bancoV2().from("instituicoes").insert(paraBanco(modelo)), "instituição");
export const removeInstituicao = (id) =>
  consulta(bancoV2().from("instituicoes").delete().eq("id", id), "instituição");

/* ---------------------------------------------------------------contas --*/
export const salvaConta = (modelo, id) => consulta(
  id ? bancoV2().from("contas").update(paraBanco(modelo)).eq("id", id)
     : bancoV2().from("contas").insert(paraBanco(modelo)), "conta");
export const removeConta = (id) =>
  consulta(bancoV2().from("contas").delete().eq("id", id), "conta");

/* Quantas transações a conta tem. É o que decide entre desativar e excluir:
   conta com histórico não se apaga, se aposenta.
   `head: true` não traz linha nenhuma -- a resposta vem em `count`, e não em
   `data`. Por isso esta função não usa `executa`: ela precisa de um campo que
   o embrulho padrão não devolve. */
export async function contaTemMovimento(contaId){
  try {
    const r = await bancoV2().from("transacoes")
      .select("id", { count: "exact", head: true }).eq("conta_id", contaId);
    if (r.error) return { dados: null, erro: erroLegivel(r.error, "conta") };
    return { dados: Number(r.count) || 0, erro: null };
  } catch (e){
    return { dados: null, erro: erroLegivel(e, "conta") };
  }
}

/* ----------------------------------------------------------- categorias --*/
export const salvaCategoria = (modelo, id) => consulta(
  id ? bancoV2().from("categorias").update(paraBanco(modelo)).eq("id", id)
     : bancoV2().from("categorias").insert(paraBanco(modelo)), "categoria");
export const removeCategoria = (id) =>
  consulta(bancoV2().from("categorias").delete().eq("id", id), "categoria");
/* o insert em lote das categorias padrão: uma chamada, não vinte */
export const criaCategorias = (lista) =>
  consulta(bancoV2().from("categorias").insert(paraBanco(lista)).select("*"), "categorias");

/* ----------------------------------------------------------- transações --
   Sempre por período. `ate` é exclusivo -- passar o primeiro dia do mês
   seguinte evita ter de saber quantos dias o mês tem. */
export function listaTransacoes({ de, ate, contaId, categoriaId, tipo, status } = {}){
  let q = bancoV2().from("transacoes").select("*");
  if (de)  q = q.gte("data", de);
  if (ate) q = q.lt("data", ate);
  if (contaId)     q = q.eq("conta_id", contaId);
  if (categoriaId) q = q.eq("categoria_id", categoriaId);
  if (tipo)        q = q.eq("tipo", tipo);
  if (status)      q = q.eq("status", status);
  return consulta(q.order("data", { ascending: false }).order("criado_em", { ascending: false }), "transações");
}

export const salvaTransacao = (modelo, id) => consulta(
  id ? bancoV2().from("transacoes").update(paraBanco(modelo)).eq("id", id)
     : bancoV2().from("transacoes").insert(paraBanco(modelo)), "transação");
export const removeTransacao = (id) =>
  consulta(bancoV2().from("transacoes").delete().eq("id", id), "transação");

/* ---------------------------------------------------------- transferência --
   As duas pernas precisam nascer e morrer JUNTAS, e duas chamadas HTTP
   independentes não dão essa garantia: a segunda pode falhar e deixar meia
   transferência no banco. Por isso vai por RPC, que roda tudo numa transação
   só do lado do Postgres. Ver `supabase/migrations/004_...`. */
export const criaTransferencia = (p) => consulta(
  bancoV2().rpc("cria_transferencia", {
    p_conta_origem:  p.contaOrigemId,
    p_conta_destino: p.contaDestinoId,
    p_valor:         p.valor,
    p_data:          p.data,
    p_descricao:     p.descricao || "Transferência",
    p_obs:           p.obs || "",
    p_status:        p.status || "realizada",
  }), "transferência");

export const atualizaTransferencia = (p) => consulta(
  bancoV2().rpc("atualiza_transferencia", {
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
  bancoV2().rpc("remove_transferencia", { p_transferencia: transferenciaId }), "transferência");

/* ------------------------------------------------------------ liquidações --
   A ponte com a V1: qual compromisso, de qual competência, foi liquidado por
   qual transação. Ver `docs/CONTRATO_PONTE.md` e a migração 005.

   O filtro é por COMPETÊNCIA e não por data: a competência é o mês a que a
   obrigação pertence, e pagar em 03/10 a parcela de setembro é normal. Mês em
   texto "AAAA-MM" ordena igual à data, então `gte`/`lte` bastam. `ate` aqui é
   INCLUSIVO, ao contrário do de `listaTransacoes` -- lá o corte é um dia, aqui
   é um mês inteiro, e "até setembro" que exclui setembro seria armadilha. */
export function listaLiquidacoes({ de, ate, tipo } = {}){
  let q = bancoV2().from("liquidacoes").select("*");
  if (de)   q = q.gte("competencia", de);
  if (ate)  q = q.lte("competencia", ate);
  if (tipo) q = q.eq("tipo", tipo);
  return consulta(q.order("competencia", { ascending: false }), "liquidações");
}

/* Uma chamada, uma transação de banco, tudo ou nada. Duas chamadas HTTP não
   servem pela mesma razão da transferência: a segunda pode falhar e deixar
   "marcou pago mas não criou a saída". */
export const liquidaCompromisso = (p) => consulta(
  bancoV2().rpc("liquida_compromisso", {
    p_tipo:        p.tipo,
    p_item_id:     p.itemId,
    p_competencia: p.competencia,
    p_conta:       p.contaId,
    p_valor:       p.valor,
    p_data:        p.data,
    p_descricao:   p.descricao,
    p_categoria:   p.categoriaId || null,
    p_obs:         p.obs || "",
  }), "pagamento");

export const recebeReceita = (p) => consulta(
  bancoV2().rpc("recebe_receita", {
    p_receita:     p.receitaId,
    p_competencia: p.competencia,
    p_conta:       p.contaId,
    p_valor:       p.valor,
    p_data:        p.data,
    p_descricao:   p.descricao,
    p_categoria:   p.categoriaId || null,
    p_obs:         p.obs || "",
  }), "recebimento");

/* Apaga a transação; o cascade leva o vínculo e o gatilho leva a marca da V1.
   Uma chamada desfaz as três coisas. */
export const desfazLiquidacao = (p) => consulta(
  bancoV2().rpc("desfaz_liquidacao", {
    p_tipo: p.tipo, p_item_id: p.itemId, p_competencia: p.competencia,
  }), "desfazer");

/* ------------------------------------------------------ cartões e faturas --
   Ver `docs/CONTRATO_CARTAO.md` e a migração 007. A regra que governa tudo
   aqui: compra no cartão é despesa; pagamento da fatura não é despesa nova. */

/* Cartões e faturas vêm juntos: a tela de Cartões não desenha um cartão sem
   saber o que ele deve. As faturas vêm da VIEW, que já traz total, pago e
   situação derivados -- consultar a tabela crua daria uma fatura sem número. */
export async function carregaCartoes(){
  const c = bancoV2();
  const [ct, fa] = await Promise.all([
    c.from("cartoes").select("*").order("ordem").order("nome"),
    c.from("faturas_resolvidas").select("*").order("vencimento", { ascending: false }),
  ]);
  const falha = [ct, fa].find((r) => r.error);
  if (falha) return { dados: null, erro: falha.error.message };
  return { erro: null, dados: { cartoes: doBanco(ct.data || []), faturas: doBanco(fa.data || []) } };
}

export const salvaCartao = (modelo, id) => consulta(
  id ? bancoV2().from("cartoes").update(paraBanco(modelo)).eq("id", id)
     : bancoV2().from("cartoes").insert(paraBanco(modelo)), "cartão");
export const removeCartao = (id) =>
  consulta(bancoV2().from("cartoes").delete().eq("id", id), "cartão");

/* Os itens de uma fatura. Carregados sob demanda, ao abrir o detalhe: uma
   fatura pode ter dezenas de linhas e a lista de cartões não precisa delas. */
export const itensDaFatura = (faturaId) => consulta(
  bancoV2().from("transacoes").select("*").eq("fatura_id", faturaId)
    .order("data", { ascending: false }), "fatura");

/* A compra e as N parcelas nascem juntas ou não nascem. Meia compra parcelada
   no banco seria pior que nenhuma, porque pareceria certa. */
export const registraCompraDeCartao = (p) => consulta(
  bancoV2().rpc("registra_compra_de_cartao", {
    p_cartao:      p.cartaoId,
    p_descricao:   p.descricao,
    p_valor_total: p.valor,
    p_data:        p.data,
    p_parcelas:    p.parcelas || 1,
    p_categoria:   p.categoriaId || null,
    p_obs:         p.obs || "",
  }), "compra");

/* Saída da conta + vínculo, numa transação. O vínculo é o MESMO mecanismo da
   ponte da 005: fatura é mais um compromisso. */
export const pagaFatura = (p) => consulta(
  bancoV2().rpc("paga_fatura", {
    p_fatura: p.faturaId, p_conta: p.contaId, p_valor: p.valor,
    p_data: p.data, p_obs: p.obs || "",
  }), "fatura");

/* Os pagamentos de UMA fatura, do mais recente para o mais antigo. Desde a 012
   uma fatura recebe N; antes era um só, e o id dele vinha na própria view. */
export const pagamentosDaFatura = (faturaId) => consulta(
  bancoV2().from("liquidacoes").select("*")
    .eq("tipo", "fatura").eq("item_id", faturaId)
    .order("criado_em", { ascending: false }), "pagamentos da fatura");

/* Desfaz UM pagamento. `desfazLiquidacao` não serve aqui: ela apaga tudo
   daquela competência, e numa fatura com três pagamentos apagaria os três --
   quem clicou queria desfazer um. Ver `supabase/migrations/012_...`. */
export const desfazPagamentoDeFatura = (pagamentoId) => consulta(
  bancoV2().rpc("desfaz_pagamento_de_fatura", { p_pagamento: pagamentoId }),
  "desfazer o pagamento");

/* Encontra OU cria a fatura do ciclo daquela data. Idempotente: chamar duas
   vezes devolve a mesma fatura, e quem garante é o `unique` do banco. */
export const faturaDoCartao = (cartaoId, data) => consulta(
  bancoV2().rpc("fatura_do_cartao", { p_cartao: cartaoId, p_data: data }), "fatura");

/* ---------------------------------------------------------- assinaturas --
   Assinatura é REGRA; ocorrência é uma transação prevista. Ver a migração 008.

   A lista vem da VIEW, que já traz custo mensal equivalente, custo anual e a
   próxima cobrança derivados. */
export const listaAssinaturas = () => consulta(
  bancoV2().from("assinaturas_resolvidas").select("*").order("ordem").order("nome"),
  "assinaturas");

export const salvaAssinatura = (modelo, id) => consulta(
  id ? bancoV2().from("assinaturas").update(paraBanco(modelo)).eq("id", id)
     : bancoV2().from("assinaturas").insert(paraBanco(modelo)), "assinatura");
export const removeAssinatura = (id) =>
  consulta(bancoV2().from("assinaturas").delete().eq("id", id), "assinatura");

/* Gera as ocorrências que faltam na janela curta. É SEGURO chamar a cada carga
   da tela: a `unique (user_id, assinatura_id, competencia)` garante que rodar
   duas vezes não duplica nada. Devolve quantas criou. */
export const materializaAssinaturas = (ate) => consulta(
  bancoV2().rpc("materializa_assinaturas", { p_ate: ate || null }), "assinaturas");

/* --------------------------------------------------- grupos e rateios --
   Grupo calcula OBRIGAÇÃO; transação calcula DINHEIRO. Ver a migração 009. */
export async function carregaGrupos(){
  const c = bancoV2();
  const [g, m, d, s] = await Promise.all([
    c.from("grupos").select("*").order("ordem").order("nome"),
    c.from("membros").select("*").order("ordem").order("nome"),
    c.from("despesas_do_grupo").select("*").order("data", { ascending: false }),
    c.from("saldos_do_grupo").select("*"),
  ]);
  const falha = [g, m, d, s].find((r) => r.error);
  if (falha) return { dados: null, erro: falha.error.message };
  return { erro: null, dados: {
    grupos: doBanco(g.data || []), membros: doBanco(m.data || []),
    despesas: doBanco(d.data || []), saldos: doBanco(s.data || []) } };
}

export const salvaGrupo = (modelo, id) => consulta(
  id ? bancoV2().from("grupos").update(paraBanco(modelo)).eq("id", id)
     : bancoV2().from("grupos").insert(paraBanco(modelo)), "grupo");
export const removeGrupo = (id) =>
  consulta(bancoV2().from("grupos").delete().eq("id", id), "grupo");

export const salvaMembro = (modelo, id) => consulta(
  id ? bancoV2().from("membros").update(paraBanco(modelo)).eq("id", id)
     : bancoV2().from("membros").insert(paraBanco(modelo)), "membro");
export const removeMembro = (id) =>
  consulta(bancoV2().from("membros").delete().eq("id", id), "membro");

/* A despesa e as partes nascem juntas ou não nascem. E a soma das partes é
   conferida pelo BANCO, num gatilho postergado que a RPC não contorna. */
export const registraDespesaDoGrupo = (p) => consulta(
  bancoV2().rpc("registra_despesa_do_grupo", {
    p_grupo: p.grupoId, p_descricao: p.descricao, p_valor: p.valor,
    p_data: p.data, p_pago_por: p.pagoPorId,
    p_rateios: p.rateios, p_categoria: p.categoriaId || null, p_obs: p.obs || "",
  }), "despesa");

export const removeDespesaDoGrupo = (id) =>
  consulta(bancoV2().from("despesas_do_grupo").delete().eq("id", id), "despesa");

/* Com conta escolhida, cria a movimentação e liga as duas. Sem conta,
   registra só a quitação da obrigação -- o dinheiro pode ter passado em
   espécie, e inventar uma entrada em conta seria pior que não registrar. */
export const registraAcerto = (p) => consulta(
  bancoV2().rpc("registra_acerto", {
    p_grupo: p.grupoId, p_de: p.deId, p_para: p.paraId, p_valor: p.valor,
    p_data: p.data, p_conta: p.contaId || null, p_obs: p.obs || "",
  }), "acerto");
