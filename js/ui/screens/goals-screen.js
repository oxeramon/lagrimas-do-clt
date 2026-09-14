/* TELA DE METAS · envelope, nunca dinheiro novo.
 *
 * A regra que esta tela existe para tornar visível está em
 * `docs/CONTRATO_METAS.md`, e é uma frase:
 *
 *   META É ENVELOPE. CONTA É ONDE O DINHEIRO ESTÁ.
 *
 * Por isso os três números do topo aparecem nesta ordem -- o que existe, o que
 * já foi prometido, e o que sobra -- e NUNCA somados. Somar os dois primeiros
 * conta o mesmo real duas vezes, que é exatamente o defeito que o contrato
 * proíbe.
 *
 * Reservar não gera transação e não mexe em saldo de conta. Isso não é um
 * detalhe de implementação: é a definição do que uma meta é.
 */
import { $ } from "../../core/dom.js";
import { esc } from "../../core/escape.js";
import { money } from "../../core/money.js";
import { PRIORIDADES, STATUS_DA_META, rotuloDaPrioridade, indicadoresDeMetas,
         ordenaMetas, necessidadeMensal, emRisco, cabeReservar,
         capacidadeMensal, ritmoDaMeta, rotuloDoRitmo, RITMO,
         temRegra, estadoDaRegra, REGRA_PENDENTE, REGRA_PARCIAL }
  from "../../domain/goals.js";
import { V2, dep, recarrega } from "./estado.js";
import { listaDeOpcoes, confirmaEmDoisCliques, mostraErro, hojeISO, diaLegivel }
  from "./pecas.js";
import { labelLong } from "../../core/dates.js";
import * as v2 from "../../data/v2-repository.js";

let metaEditando = null;
let metaAlocando = null;

/* A CAPACIDADE MENSAL: o que o mês produz e pode virar reserva. Ela vem da
   sobra publicada pelo Painel, porque nasce da V1 -- compromissos e receitas
   do mês -- e esta tela não alcança a V1. `docs/CONTRATO_SOBRA.md`.

   Vem `null` enquanto o Painel não rodou, ou num mês sem entrada nenhuma, e
   `null` NÃO é zero: sem referência nenhuma meta é julgada. Zero marcaria
   TODA meta com prazo em risco no primeiro minuto de uso, e alarme que toca
   sozinho ensina a ignorar alarme.

   O estouro do reservado continua sendo avisado em qualquer caso: aquele não
   depende de estimativa nenhuma -- é dinheiro prometido que já saiu. */
const capacidade = () => capacidadeMensal(V2.sobra);

export function renderMetas(){
  const tem = (V2.metas || []).length > 0;
  if ($("metasVazio")) $("metasVazio").hidden = tem;
  if ($("metasConteudo")) $("metasConteudo").hidden = !tem;
  if (!tem) return;

  const ind = indicadoresDeMetas(V2.metas, V2.saldoLivre, capacidade());

  $("mtLivre").textContent      = money(ind.saldoLivre);
  $("mtReservado").textContent  = money(ind.reservado);
  $("mtDisponivel").textContent = money(ind.disponivel);
  $("mtQuantas").textContent    = String(ind.quantas);
  $("mtAlvo").textContent       = money(ind.alvo);
  $("mtFalta").textContent      = money(ind.falta);
  $("mtPorMes").textContent     = ind.precisaPorMes > 0 ? money(ind.precisaPorMes) : "—";

  /* O aviso do estouro é UM, não um por meta: a causa é a mesma para todas.
     E ele não tem piada -- o dinheiro prometido não está mais lá. */
  const aviso = $("mtAviso");
  const semBase = ind.capacidade == null && ind.quantas > 0;
  const aperto = ind.capacidadeRestante != null && ind.capacidadeRestante < 0;
  aviso.hidden = !ind.estourado && !aperto && !semBase;
  if (ind.estourado) aviso.textContent =
    "Você reservou " + money(ind.reservado) + " e tem " + money(ind.saldoLivre)
    + " livre em conta. O dinheiro prometido saiu depois da promessa: reveja as metas.";
  else if (aperto) aviso.textContent =
    "Juntas, as metas pedem " + money(ind.precisaPorMes) + " por mês, e o mês sobra "
    + money(ind.capacidade) + ". Uma de cada vez cabe; todas ao mesmo tempo, não.";
  else if (semBase) aviso.textContent =
    "Ainda não dá para dizer se as metas estão no ritmo: este mês não tem nenhuma "
    + "entrada registrada, e sem isso não há com o que comparar.";
  aviso.classList.toggle("alerta", ind.estourado);

  $("listaMetas").innerHTML = ordenaMetas(V2.metas, capacidade())
    .map((m) => linhaDeMeta(m, ind.precisaPorMes)).join("");

  /* Desfazer apaga uma linha do histórico, então vai em dois cliques como todo
     o resto. Ele é ligado AQUI, e não por delegação, porque `confirmaEmDoisCliques`
     guarda o estado armado no próprio fecho -- ligar no clique criaria um
     ouvinte novo a cada clique, e o terceiro clique dispararia dois. */
  for (const botao of $("listaMetas").querySelectorAll("[data-desfazregra]"))
    confirmaEmDoisCliques(botao, "Desfazer",
      () => desfazRegra(botao.getAttribute("data-desfazregra")), "Confirmar");
}

/* Só estes quatro viram etiqueta. `sem prazo` e `sem referência` não ganham
   nenhuma: não há o que afirmar, e etiqueta em toda meta de um app
   recém-instalado é ruído em vez de aviso. */
const COM_ETIQUETA = new Set([RITMO.EM_RISCO, RITMO.ATENCAO, RITMO.NO_RITMO, RITMO.CONCLUIDA]);

function linhaDeMeta(m, precisaPorMes){
  const precisa = necessidadeMensal(m);
  const ritmo = ritmoDaMeta(m, capacidade(), precisaPorMes);
  const concluida = m.status === "concluida";
  const arquivada = m.status === "arquivada";

  /* A barra é enfeite do número, não substituta dele: o percentual vai escrito
     ao lado, porque barra sozinha não se lê com precisão. */
  const sub = [
    money(m.reservado) + " de " + money(m.valorAlvo),
    m.prazo ? "até " + diaLegivel(m.prazo) : "sem prazo",
    precisa ? money(precisa) + " por mês" : "",
    rotuloDaPrioridade(m.prioridade),
    arquivada ? "arquivada" : (concluida ? "concluída" : ""),
  ].filter(Boolean).join(" · ");

  return '<div class="meta-card' + (arquivada ? " apagada" : "") + '">'
    + '<div class="meta-topo">'
    + '<div style="min-width:0"><b class="nome">' + esc(m.nome) + '</b>'
    + '<span class="meta-sub">' + esc(sub) + '</span></div>'
    + (COM_ETIQUETA.has(ritmo) && !arquivada
        ? '<span class="pill ritmo-' + ritmo + '">' + esc(rotuloDoRitmo(ritmo)) + '</span>' : "")
    + '<span class="meta-pct num">' + m.percentual + '%</span>'
    + '</div>'
    + '<div class="barra"><span style="--frac:' + m.percentual + '%"></span></div>'
    + blocoDaRegra(m)
    + '<div class="meta-acoes">'
    + '<button type="button" class="btn ghost sm" data-alocameta="' + esc(m.metaId) + '">Reservar</button>'
    + '<button type="button" class="btn ghost sm" data-editameta="' + esc(m.metaId) + '">Editar</button>'
    + '</div></div>';
}

/* A REGRA MENSAL no cartão da meta: uma frase e um botão, e sempre sobre o MÊS
   EM FOCO -- o mesmo que o resto do app está mostrando.

   Não existe botão para aplicar mês passado. A regra pertence ao mês que está
   na tela, e um botão que aplicasse "os meses que faltaram" criaria reservas
   que ninguém pediu, em datas que ninguém escolheu.

   Ela é linha PRÓPRIA, e não mais um botão na barra de ações: três botões numa
   linha já estouram a largura em 320px, e o texto aqui é longo demais para
   caber ao lado dos outros dois. */
function blocoDaRegra(m){
  if (!temRegra(m) || m.status !== "ativa") return "";
  const { estado, faltou } = estadoDaRegra(m, V2.alocacoes, V2.mes);
  const mes = labelLong(V2.mes);

  if (estado === REGRA_PENDENTE)
    return '<div class="meta-regra"><span>Regra: ' + esc(money(m.regraValor))
      + ' por mês</span><button type="button" class="btn ghost sm" data-aplicaregra="'
      + esc(m.metaId) + '">Reservar ' + esc(mes) + '</button></div>';

  /* Já aplicada. O que faltou é DERIVADO, e aparece porque muda a decisão:
     coube 300 de 500, e os 200 que faltaram não voltam sozinhos. */
  const rotulo = estado === REGRA_PARCIAL
    ? "Coube " + money(Number(m.regraValor) - faltou) + " dos " + money(m.regraValor)
      + " de " + mes
    : money(m.regraValor) + " reservado em " + mes;
  return '<div class="meta-regra' + (estado === REGRA_PARCIAL ? " parcial" : "") + '">'
    + '<span>' + esc(rotulo) + '</span>'
    + '<button type="button" class="btn ghost sm" data-desfazregra="' + esc(m.metaId)
    + '">Desfazer</button></div>';
}

/* ---------------------------------------------------------- cadastro --*/
function abreMeta(id){
  metaEditando = id || null;
  const m = id ? (V2.metas || []).find((x) => x.metaId === id) : null;

  $("mtTitulo").textContent = m ? "Editar meta" : "Nova meta";
  $("mt_nome").value  = m ? m.nome : "";
  $("mt_alvo").value  = m ? m.valorAlvo : "";
  $("mt_prazo").value = m && m.prazo ? m.prazo : "";
  $("mt_prioridade").innerHTML = listaDeOpcoes(
    PRIORIDADES.map((p) => ({ id: String(p.id), rotulo: p.rotulo })),
    String(m ? m.prioridade : 2), "");
  $("mt_status").innerHTML = listaDeOpcoes(STATUS_DA_META, m ? m.status : "ativa", "");
  /* Vazio significa SEM regra. Não há caixa de "ativar": um valor em branco
     já diz tudo, e dois controles para um estado só é onde eles discordam. */
  $("mt_regra").value = m && m.regraAtiva && m.regraValor ? m.regraValor : "";
  $("mt_obs").value = m ? (m.obs || "") : "";
  $("mtExcluir").hidden = !m;
  mostraErro($("mtErro"), "");
  mostraEquivalenteDaMeta();
  $("dlgMeta").showModal();
}

/* A conta que a pessoa faria de cabeça, feita para ela: quanto por mês até o
   prazo. Ela aparece ANTES de salvar, porque é ela que diz se a meta é
   possível -- e descobrir depois é descobrir tarde. */
function mostraEquivalenteDaMeta(){
  const alvo = Number($("mt_alvo").value);
  const prazo = $("mt_prazo").value;
  const campo = $("mtEquivalente");
  if (!(alvo > 0) || !prazo){ campo.hidden = true; return; }

  const hoje = new Date(hojeISO() + "T00:00:00");
  const fim = new Date(prazo + "T00:00:00");
  const meses = Math.max(1,
    (fim.getFullYear() - hoje.getFullYear()) * 12 + (fim.getMonth() - hoje.getMonth()) + 1);
  campo.hidden = false;
  campo.textContent = "São " + money(alvo / meses) + " por mês até lá"
    + (meses === 1 ? " — e o prazo é este mês." : " (" + meses + " meses).");
}

/* ---------------------------------------------------------- alocação --*/
function abreAlocacao(metaId){
  const m = (V2.metas || []).find((x) => x.metaId === metaId);
  if (!m) return;
  metaAlocando = m;

  const ind = indicadoresDeMetas(V2.metas, V2.saldoLivre, capacidade());
  const cabe = cabeReservar(V2.saldoLivre, ind.reservado);

  $("alTitulo").textContent = "Reservar para " + m.nome;
  $("alMeta").textContent = m.nome + " · alvo " + money(m.valorAlvo);
  $("alReservado").textContent = money(m.reservado);
  $("alFalta").textContent = money(m.falta);
  $("alCabe").textContent = money(cabe);

  /* O padrão é o MENOR entre o que falta e o que cabe: propor o que falta
     quando não há saldo é propor um valor que o banco recusa. */
  const sugerido = Math.min(Number(m.falta || 0), cabe);
  $("al_valor").value = sugerido > 0 ? sugerido.toFixed(2) : "";
  $("al_data").value = hojeISO();
  $("al_obs").value = "";
  mostraErro($("alErro"), "");

  $("alAviso").textContent = cabe > 0
    ? "Reservar não tira dinheiro da conta. Ele continua lá, só deixa de estar livre."
    : "Não há saldo livre para reservar agora. Você ainda pode liberar o que já reservou.";
  $("alReservar").hidden = cabe <= 0;
  $("alLiberar").hidden = Number(m.reservado || 0) <= 0;

  const historico = (V2.alocacoes || []).filter((a) => a.metaId === metaId);
  $("alHistorico").innerHTML = historico.length
    ? '<h3 class="sub-titulo">Histórico</h3><div class="fatura-itens">'
      + historico.map((a) =>
          '<div class="row"><div class="desc"><b>'
          + (Number(a.valor) > 0 ? "+ " : "− ") + money(Math.abs(Number(a.valor))) + '</b>'
          + '<span class="meta">' + esc(diaLegivel(a.data))
          + (a.obs ? " · " + esc(a.obs) : "") + '</span></div>'
          + '<div class="amt"><button type="button" class="btn ghost sm" '
          + 'data-apagaaloc="' + esc(a.id) + '">Apagar</button></div></div>').join("")
      + '</div>'
    : "";

  for (const botao of $("alHistorico").querySelectorAll("[data-apagaaloc]"))
    confirmaEmDoisCliques(botao, "Apagar", async () => {
      const r = await v2.removeAlocacao(botao.getAttribute("data-apagaaloc"));
      if (r.erro) return mostraErro($("alErro"), r.erro);
      $("dlgAlocacao").close();
      dep.toast("Movimento apagado.");
      await recarrega();
    });

  $("dlgAlocacao").showModal();
}

async function registraAlocacao(sinal){
  if (!metaAlocando) return;
  const bruto = Number($("al_valor").value);
  const data = $("al_data").value;
  if (!(bruto > 0)) return mostraErro($("alErro"), "O valor precisa ser maior que zero.");
  if (!data) return mostraErro($("alErro"), "Escolha a data.");

  if (sinal < 0 && bruto > Number(metaAlocando.reservado || 0))
    return mostraErro($("alErro"),
      "Você reservou " + money(metaAlocando.reservado) + " nesta meta e quer liberar "
      + money(bruto) + ".");

  const r = await v2.alocaNaMeta({
    metaId: metaAlocando.metaId,
    valor: sinal * bruto,
    data,
    obs: $("al_obs").value.trim(),
  });
  if (r.erro) return mostraErro($("alErro"), r.erro);
  $("dlgAlocacao").close();
  dep.toast(sinal > 0 ? "Reservado." : "Liberado.");
  await recarrega();
}

/* --------------------------------------------------------- a regra --------
   Aplicar é uma chamada ao banco, e não uma soma na tela. O banco é quem
   decide quanto cabe, e é quem recusa a segunda aplicação do mesmo mês -- duas
   abas abertas no mesmo app fariam a segunda reserva se quem decidisse fosse
   um `if` daqui.

   A tela só traduz a resposta. E ela traduz os TRÊS casos, porque são três
   coisas diferentes para quem lê:
     alocou tudo    a reserva do mês está feita
     alocou parte   coube o que havia; o que faltou continua faltando
     alocou nada    não havia saldo livre, e nenhuma linha foi criada */
async function aplicaRegra(botao, metaId){
  const m = (V2.metas || []).find((x) => x.metaId === metaId);
  if (!m) return;
  botao.disabled = true;
  const r = await v2.aplicaRegraDeMeta(metaId, V2.mes);
  botao.disabled = false;
  if (r.erro) return dep.erro("Não deu para reservar. " + r.erro);

  const { alocado, jaAplicada, disponivel } = r.dados;
  if (jaAplicada) dep.toast("A regra deste mês já tinha sido aplicada.");
  else if (alocado <= 0) dep.toast(
    "Não há saldo livre para reservar agora"
    + (disponivel > 0 ? " além de " + money(disponivel) + "." : "."));
  else if (alocado < Number(m.regraValor)) dep.toast(
    "Reservado " + money(alocado) + " dos " + money(m.regraValor)
    + ": era o que havia livre.");
  else dep.toast("Reservado " + money(alocado) + ".");
  await recarrega();
}

/* Desfazer apaga a alocação DAQUELE mês, e só ela. As alocações manuais da
   mesma meta ficam onde estão: elas não vieram da regra. */
async function desfazRegra(metaId){
  const r = await v2.desfazRegraDeMeta(metaId, V2.mes);
  if (r.erro) return dep.erro("Não deu para desfazer. " + r.erro);
  dep.toast(r.dados ? "Reserva do mês desfeita." : "Não havia reserva da regra neste mês.");
  await recarrega();
}

export function ligaMetas(){
  $("btnNovaMeta")?.addEventListener("click", () => abreMeta(null));
  $("mt_alvo")?.addEventListener("input", mostraEquivalenteDaMeta);
  $("mt_prazo")?.addEventListener("input", mostraEquivalenteDaMeta);

  $("listaMetas")?.addEventListener("click", (e) => {
    const editar = e.target.closest("[data-editameta]");
    if (editar) return abreMeta(editar.getAttribute("data-editameta"));
    const alocar = e.target.closest("[data-alocameta]");
    if (alocar) return abreAlocacao(alocar.getAttribute("data-alocameta"));
    const aplicar = e.target.closest("[data-aplicaregra]");
    if (aplicar) return aplicaRegra(aplicar, aplicar.getAttribute("data-aplicaregra"));
  });

  $("formMeta")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("mtSalvar"); btn.disabled = true;
    const regra = Number($("mt_regra").value) || 0;
    const r = await v2.salvaMeta({
      nome: $("mt_nome").value.trim(),
      valorAlvo: Number($("mt_alvo").value),
      prazo: $("mt_prazo").value || null,
      prioridade: Number($("mt_prioridade").value),
      status: $("mt_status").value,
      obs: $("mt_obs").value.trim(),
      /* O banco cobra `regra_ativa => regra_valor is not null`. Mandar os dois
         juntos, sempre, é o que impede o par meio preenchido -- limpar um e
         esquecer o outro deixaria uma regra ativa sem valor, e o check
         recusaria o salvamento inteiro sem a pessoa entender por quê. */
      regraValor: regra > 0 ? regra : null,
      regraAtiva: regra > 0,
    }, metaEditando);
    btn.disabled = false;
    if (r.erro) return mostraErro($("mtErro"), r.erro);
    $("dlgMeta").close();
    await recarrega();
    dep.toast(metaEditando ? "Meta atualizada." : "Meta criada.");
  });

  confirmaEmDoisCliques($("mtExcluir"), "Excluir", async () => {
    const r = await v2.removeMeta(metaEditando);
    if (r.erro) return mostraErro($("mtErro"), r.erro);
    $("dlgMeta").close();
    await recarrega();
    dep.toast("Meta excluída.");
  });

  $("alReservar")?.addEventListener("click", () => registraAlocacao(+1));
  $("alLiberar")?.addEventListener("click", () => registraAlocacao(-1));
}
