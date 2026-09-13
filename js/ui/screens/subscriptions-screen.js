/* TELA DE ASSINATURAS: o que se repete sozinho todo mês. */
import { $ } from "../../core/dom.js";
import { esc } from "../../core/escape.js";
import { money } from "../../core/money.js";
import { FREQUENCIAS, rotuloDaFrequencia, materializa, custoMensal, custoAnual,
         indicadoresDeAssinaturas, proximasCobrancas, meioDaAssinatura, venceu }
  from "../../domain/subscriptions.js";
import { categoriasPorFluxo, caminhoDaCategoria } from "../../domain/categories.js";
import { V2, dep, recarrega, opcoesDeConta } from "./estado.js";
import { dinheiro, selo, listaDeOpcoes, confirmaEmDoisCliques, mostraErro,
         hojeISO, diaLegivel } from "./pecas.js";
import * as v2 from "../../data/v2-repository.js";

/* ==================================================================
   ASSINATURAS
   ==================================================================
   Esta tela fala de REGRA. A ocorrência -- a cobrança de um mês específico --
   é uma transação prevista e aparece em Transações, no Mês e na fatura do
   cartão. Somar as duas contaria o mesmo dinheiro duas vezes.

   O custo mensal equivalente é o número que dá sentido à tela: sem ele, não dá
   para comparar R$ 120 por ano com R$ 30 por mês, e comparar é a única razão
   pela qual alguém abre isto aqui. */

const PIADAS_ASSINATURA = [
  "R$ 19,90 também faz estrago em grupo.",
  "Ninguém assina uma de cada vez.",
  "A soma é sempre maior do que a lembrança.",
];

let assinaturaEditando = null;

export function renderAssinaturas(){
  const tem = V2.assinaturas.length > 0;
  const vazio = $("assinaturasVazio"), conteudo = $("assinaturasConteudo");
  if (!vazio || !conteudo) return;
  vazio.hidden = tem;
  conteudo.hidden = !tem;
  if (!tem) return;

  const hoje = hojeISO();
  const ind = indicadoresDeAssinaturas(V2.assinaturas, hoje);
  $("asMensal").textContent = money(ind.mensal);
  $("asAnual").textContent = money(ind.anual);
  $("asQuantidade").textContent = String(ind.quantidade);
  $("asMaior").textContent = ind.maior ? ind.maior.nome : "—";
  $("asPiada").textContent = PIADAS_ASSINATURA[V2.assinaturas.length % PIADAS_ASSINATURA.length];

  const proximas = proximasCobrancas(V2.assinaturas, hoje, 3);
  const aviso = $("asProximas");
  aviso.hidden = proximas.length === 0;
  if (!aviso.hidden){
    aviso.textContent = "Vem por aí: " + proximas.map((a) =>
      a.nome + " em " + diaLegivel(a.proximaCobranca) + " (" + money(a.valor) + ")").join(" · ") + ".";
  }

  $("listaAssinaturas").innerHTML = V2.assinaturas.map((a) => {
    const inativa = a.ativo === false || venceu(a, hoje);
    const meio = meioDaAssinatura(a, V2.contas, V2.cartoes);
    /* O equivalente aparece SÓ quando ele diz algo que o valor não diz. Numa
       assinatura mensal os dois números são iguais, e repetir seria ruído. */
    const equivale = a.frequencia !== "mensal"
      ? " · " + money(custoMensal(a.valor, a.frequencia)) + "/mês equivalente" : "";
    return '<div class="assinatura-linha' + (inativa ? " off" : "") + '">'
      + selo(a.nome, null, a.logo)
      + '<div class="desc"><b>' + esc(a.nome) + '</b>'
      + '<span class="meta">' + esc(rotuloDaFrequencia(a.frequencia)) + esc(equivale)
      + ' · ' + esc(meio.rotulo)
      + (inativa ? ' · pausada' : '')
      /* a tela avisa, em vez de deixar a pessoa esperar por uma cobrança que
         nunca vai ser lançada */
      + (!materializa(a.frequencia) && !inativa
          ? ' · <span class="pill">ainda não vira lançamento</span>' : '')
      + '</span></div>'
      + '<div class="amt">' + money(a.valor) + '</div>'
      + '<button class="btn ghost sm" data-editassinatura="' + esc(a.id) + '">Editar</button>'
      + '</div>';
  }).join("");
}

function abreAssinatura(id){
  assinaturaEditando = id || null;
  const a = id ? V2.assinaturas.find((x) => x.id === id) : null;
  $("asTitulo").textContent = a ? "Editar assinatura" : "Nova assinatura";
  $("as_nome").value = a ? a.nome : "";
  $("as_valor").value = a ? a.valor : "";
  $("as_frequencia").innerHTML = listaDeOpcoes(
    FREQUENCIAS.map((f) => ({ id: f.id, rotulo: f.rotulo })), a ? a.frequencia : "mensal", "");
  $("as_inicio").value = a ? a.inicio : hojeISO();
  $("as_fim").value = a && a.fim ? a.fim : "";
  $("as_logo").value = a && a.logo ? a.logo : "";
  $("as_obs").value = a ? a.obs || "" : "";
  $("as_ativo").value = a && a.ativo === false ? "nao" : "sim";
  /* Conta e cartão num seletor só: eles são mutuamente exclusivos no banco, e
     dois campos deixariam a pessoa preencher os dois e levar uma recusa. */
  $("as_meio").innerHTML = listaDeOpcoes(
    V2.contas.filter((c) => c.ativo !== false).map((c) => ({ id: "conta:" + c.id, rotulo: c.nome }))
      .concat(V2.cartoes.filter((k) => k.ativo !== false)
        .map((k) => ({ id: "cartao:" + k.id, rotulo: k.nome + " (cartão)" }))),
    a ? (a.contaId ? "conta:" + a.contaId : a.cartaoId ? "cartao:" + a.cartaoId : "") : "",
    "Ainda não escolhido");
  $("as_categoria").innerHTML = listaDeOpcoes(
    categoriasPorFluxo(V2.categorias, "saida")
      .map((c) => ({ id: c.id, rotulo: caminhoDaCategoria(V2.categorias, c.id) })),
    a ? a.categoriaId : "", "Sem categoria");
  $("asExcluir").hidden = !a;
  mostraErro($("asErro"), "");
  mostraEquivalente();
  $("dlgAssinatura").showModal();
}

/* Quanto isso custa por mês e por ano, enquanto se digita. Numa assinatura
   mensal o equivalente é o próprio valor, então o aviso some -- repetir o
   mesmo número com outro nome é como se perde a confiança num indicador. */
function mostraEquivalente(){
  const valor = Number($("as_valor").value);
  const freq = $("as_frequencia").value;
  const aviso = $("asEquivalente");
  if (!(valor > 0) || freq === "mensal"){ aviso.hidden = true; return; }
  aviso.hidden = false;
  aviso.textContent = "Equivale a " + money(custoMensal(valor, freq)) + " por mês, "
    + money(custoAnual(valor, freq)) + " por ano."
    /* A ressalva ficou vazia com a 011: toda frequência materializa agora,
       semanal inclusive. O gancho fica porque a pergunta continua legítima. */
    + (materializa(freq) ? "" : " Esta frequência ainda não vira lançamento automático.");
}

export function ligaAssinaturas(){
  $("btnPrimeiraAssinatura")?.addEventListener("click", () => abreAssinatura(null));
  $("btnNovaAssinatura")?.addEventListener("click", () => abreAssinatura(null));
  $("as_valor")?.addEventListener("input", mostraEquivalente);
  $("as_frequencia")?.addEventListener("change", mostraEquivalente);

  $("listaAssinaturas")?.addEventListener("click", (e) => {
    const b = e.target.closest("[data-editassinatura]");
    if (b) abreAssinatura(b.getAttribute("data-editassinatura"));
  });

  $("formAssinatura")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const meio = $("as_meio").value;
    const modelo = {
      nome: $("as_nome").value.trim(),
      valor: Number($("as_valor").value),
      frequencia: $("as_frequencia").value,
      inicio: $("as_inicio").value,
      fim: $("as_fim").value || null,
      contaId:  meio.startsWith("conta:")  ? meio.slice(6) : null,
      cartaoId: meio.startsWith("cartao:") ? meio.slice(7) : null,
      categoriaId: $("as_categoria").value || null,
      logo: $("as_logo").value.trim(),
      obs: $("as_obs").value.trim(),
      ativo: $("as_ativo").value === "sim",
    };
    if (!modelo.nome) return mostraErro($("asErro"), "Dê um nome à assinatura.");
    if (!(modelo.valor > 0)) return mostraErro($("asErro"), "O valor precisa ser maior que zero.");
    if (!modelo.inicio) return mostraErro($("asErro"), "Escolha a data da primeira cobrança.");
    if (modelo.fim && modelo.fim < modelo.inicio)
      return mostraErro($("asErro"), "A data de fim não pode ser antes da primeira cobrança.");

    const r = await v2.salvaAssinatura(modelo, assinaturaEditando);
    if (r.erro) return mostraErro($("asErro"), r.erro);
    $("dlgAssinatura").close();
    dep.toast(assinaturaEditando ? "Assinatura salva." : "Assinatura criada.");
    await recarrega();
  });

  const excluir = $("asExcluir");
  if (excluir) confirmaEmDoisCliques(excluir, "Excluir", async () => {
    const r = await v2.removeAssinatura(assinaturaEditando);
    if (r.erro) return mostraErro($("asErro"), r.erro);
    $("dlgAssinatura").close();
    dep.toast("Assinatura excluída.");
    await recarrega();
  });
}

