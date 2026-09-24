/* Acesso às oito tabelas da V1.
 *
 * Este arquivo é uma MUDANÇA DE ENDEREÇO, não de comportamento. Cada função
 * aqui era uma chamada solta dentro de um handler do `index.html`, e a regra
 * que ela executa continua exatamente a mesma -- incluindo as manhas que
 * existem por um motivo e estão comentadas onde estão.
 *
 * A UI não fala mais `sb.from(...)`. Ela chama daqui e recebe sempre
 * `{ dados, erro }`, com `erro` já em português e curto. Quem decide se isso
 * vira toast, caixa vermelha ou silêncio é a tela.
 */
import { conexao, executa, erroLegivel, tokenAindaNaoValido } from "./client.js";

/* nome privado e distinto por arquivo: a prévia achata todos os módulos
   num escopo só, e dois `const sb` colidiriam. */
const bancoV1 = () => conexao.sb;

/* ------------------------------------------------------------------ carga --
   Tudo de uma vez, em paralelo. A lista do que é FATAL não é a lista do que é
   consultado, e a diferença é deliberada:

   - `fixas_mes` fica de fora porque o site já publicou antes da migração
     rodar, e o app inteiro parou por uma tabela que só guarda ajuste de valor.
     Sem ela, conta variável mostra a média: degrada para MENOS informação,
     nunca para informação errada.
   - `pagamentos` tem de ser fatal. Sem ela tudo apareceria como não pago, e aí
     o app mentiria em vez de saber menos. */
export async function carregaTudoV1(){
  const c = bancoV1();
  const consultas = [
    () => c.from("dividas").select("*").order("ordem"),
    () => c.from("fixas").select("*").order("ordem"),
    () => c.from("credores").select("*").order("ordem"),
    () => c.from("receitas").select("*").order("ordem"),
    () => c.from("pagamentos").select("mes,item_id"),
    () => c.from("fixas_mes").select("mes,fixa_id,valor"),
    () => c.from("config").select("renda").maybeSingle(),
  ];
  const resultados = await Promise.all(consultas.map((consulta) => consulta()));
  const pendentes = resultados.map((r, i) => tokenAindaNaoValido(r.error) ? i : -1)
    .filter((i) => i >= 0);
  if (pendentes.length){
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const repetidos = await Promise.all(pendentes.map((i) => consultas[i]()));
    pendentes.forEach((i, n) => { resultados[i] = repetidos[n]; });
  }
  const [dv, fx, cr, rc, pg, fm, cf] = resultados;

  /* As respostas continuam traduzidas antes de chegar à tela. */
  const falha = [dv, fx, cr, rc, pg, cf].find((r) => r.error);
  if (falha) return { dados: null, erro: erroLegivel(falha.error), fatal: true };

  return {
    erro: null,
    fatal: false,
    /* `fixas_mes` devolve o erro separado: a tela avisa sem parar de funcionar */
    erroFixasMes: fm.error ? erroLegivel(fm.error) : null,
    dados: {
      dividas: dv.data || [],
      fixas: fx.data || [],
      credores: cr.data || [],
      receitas: rc.data || [],
      pagamentos: pg.data || [],
      fixasMes: fm.error ? [] : (fm.data || []),
      renda: cf.data ? cf.data.renda : 0,
    },
  };
}

/* ----------------------------------------------------------- pagamentos --
   `item_id` é texto livre e não chave estrangeira: guarda o id da dívida ou
   "fx:<id da fixa>". O banco não sabe ligar os dois, e é por isso que apagar
   dívida ou fixa exige limpar as marcas à mão, logo abaixo. */
export const marcaPagos   = (mes, ids)  => executa(bancoV1().from("pagamentos").insert(ids.map((id) => ({ mes, item_id: id }))), "marcação");
export const desmarcaPagos = (mes, ids) => executa(bancoV1().from("pagamentos").delete().eq("mes", mes).in("item_id", ids), "marcação");
export const marcaPago    = (mes, id)   => executa(bancoV1().from("pagamentos").insert({ mes, item_id: id }), "marcação");
export const desmarcaPago = (mes, id)   => executa(bancoV1().from("pagamentos").delete().eq("mes", mes).eq("item_id", id), "marcação");
export const limpaPagamentosDe = (itemId) => executa(bancoV1().from("pagamentos").delete().eq("item_id", itemId), "marcação");

/* -------------------------------------------------------------- dividas --*/
export const salvaDivida = (corpo, id) => executa(
  id ? bancoV1().from("dividas").update(corpo).eq("id", id)
     : bancoV1().from("dividas").insert(corpo), "dívida");
export const removeDivida = (id) => executa(bancoV1().from("dividas").delete().eq("id", id), "dívida");
export const importaDividas = (linhas) => executa(bancoV1().from("dividas").insert(linhas), "importação");
export const renomeiaCredorNasDividas = (credorId, nome) =>
  executa(bancoV1().from("dividas").update({ credor: nome }).eq("credor_id", credorId), "dívida");

/* ------------------------------------------------------------- credores --*/
export const salvaCredor = (corpo, id) => executa(
  id ? bancoV1().from("credores").update(corpo).eq("id", id)
     : bancoV1().from("credores").insert(corpo), "credor");
export const removeCredor = (id) => executa(bancoV1().from("credores").delete().eq("id", id), "credor");
export const criaCredorRapido = (nome, ordem) => executa(
  bancoV1().from("credores").insert({ nome, tipo: "Pessoa", ativo: true, ordem })
      .select("id").single(), "credor");

/* ------------------------------------------------------------- receitas --*/
export const salvaReceita = (corpo, id) => executa(
  id ? bancoV1().from("receitas").update(corpo).eq("id", id)
     : bancoV1().from("receitas").insert(corpo), "receita");
export const removeReceita = (id) => executa(bancoV1().from("receitas").delete().eq("id", id), "receita");

/* ---------------------------------------------------------------- fixas --*/
export const salvaFixa = (corpo, id) => executa(
  id ? bancoV1().from("fixas").update(corpo).eq("id", id)
     : bancoV1().from("fixas").insert(corpo), "conta fixa");
export const removeFixa = (id) => executa(bancoV1().from("fixas").delete().eq("id", id), "conta fixa");

/* `fixas_mes` guarda quanto a conta variável veio num mês. Ela existe porque o
   dado NÃO se deriva: a conta de luz chega com o valor que chega. */
export const informaValorDoMes = (uid, fixaId, mes, valor) => executa(
  bancoV1().from("fixas_mes").upsert({ user_id: uid, fixa_id: fixaId, mes, valor },
                                { onConflict: "user_id,fixa_id,mes" }), "valor do mês");
export const voltaParaMedia = (fixaId, mes) => executa(
  bancoV1().from("fixas_mes").delete().eq("fixa_id", fixaId).eq("mes", mes), "valor do mês");

/* --------------------------------------------------------------- config --*/
export const salvaRenda = (uid, renda) => executa(
  bancoV1().from("config").upsert({ user_id: uid, renda }, { onConflict: "user_id" }), "renda");
