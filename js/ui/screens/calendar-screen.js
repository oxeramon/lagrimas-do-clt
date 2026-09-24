/* O CALENDÁRIO FINANCEIRO, dentro da aba Mês.
 *
 * A aba continua se chamando `mes` no registro e no DOM, de propósito: o id é
 * conhecido pelo `index.html`, pelos testes e pela navegação, e renomear um id
 * para trocar um RÓTULO é pagar caro por nada. O que a pessoa lê mudou; o que o
 * código chama, não.
 *
 * DUAS VISÕES DO MESMO DADO. A grade de sete colunas é ótima no desktop e
 * ilegível em 320px -- sete colunas de 40px não cabem, e espremer vira enigma.
 * Por isso o celular abre na Agenda, que é cronológica, e o desktop na grade. A
 * escolha da pessoa manda sobre as duas.
 *
 * ESTADO NUNCA SÓ POR COR. Cada evento leva ícone, rótulo e posição além da
 * cor -- quem não distingue matiz continua lendo "Atrasado".
 */
import { $ } from "../../core/dom.js";
import { esc } from "../../core/escape.js";
import { money } from "../../core/money.js";
import { eventosDoMes, porDia, semDiaCerto, resumoDoCalendario, gradeDoMes,
         rotuloDoEstado, iconeDoEstado } from "../../domain/calendar.js";
import { V2 } from "./estado.js";
import { hojeISO, diaLegivel } from "./pecas.js";

/* Quem entrega os compromissos e as receitas da V1. Eles moram no `index.html`,
   que é a dívida técnica conhecida do projeto -- em vez de importá-lo (nem
   poderia: ele não exporta), a V1 se registra aqui. Enquanto ninguém registrar,
   o calendário mostra só o que a V2 sabe, o que é pouco mas é verdade. */
let fonteDaV1 = () => ({ compromissos: [], receitas: [] });
export const registraFonteDaV1 = (fn) => { fonteDaV1 = fn || fonteDaV1; };

/* No celular a Agenda é o padrão. `null` = ninguém escolheu ainda, então vale a
   largura; depois da primeira escolha, vale a escolha. */
let visaoEscolhida = null;
const ehCelular = () => window.matchMedia("(max-width: 700px)").matches;
const visaoAtual = () => visaoEscolhida || (ehCelular() ? "agenda" : "mes");

let diaAberto = null;
let semDiaAberto = false;

export function renderCalendario(){
  const card = $("calendarioCard");
  if (!card) return;

  const mes = V2.mes;
  const daV1 = fonteDaV1() || {};
  const eventos = eventosDoMes({
    mes,
    hoje: hojeISO(),
    transacoes: V2.transacoes,
    liquidacoes: V2.liquidacoes,
    faturas: V2.faturas,
    cartoes: V2.cartoes,
    compromissos: daV1.compromissos || [],
    receitas: daV1.receitas || [],
  });

  const r = resumoDoCalendario(eventos);
  $("calAPagar").textContent   = money(r.aPagar);
  $("calPago").textContent     = money(r.pago);
  $("calAReceber").textContent = money(r.aReceber);
  $("calRecebido").textContent = money(r.recebido);

  /* Atraso não tem piada: é dinheiro que já custou juros. */
  const atraso = $("calAtraso");
  atraso.hidden = r.atrasados === 0;
  atraso.classList.toggle("alerta", r.atrasados > 0);
  if (r.atrasados > 0) atraso.textContent = r.atrasados === 1
    ? "1 compromisso venceu e não foi pago."
    : r.atrasados + " compromissos venceram e não foram pagos.";

  const visao = visaoAtual();
  $("btnVisaoMes").setAttribute("aria-pressed", String(visao === "mes"));
  $("btnVisaoAgenda").setAttribute("aria-pressed", String(visao === "agenda"));
  $("calGrade").hidden = visao !== "mes";
  $("calAgenda").hidden = visao !== "agenda";

  if (visao === "mes") desenhaGrade(mes, eventos);
  else desenhaAgenda(eventos);

  desenhaDia(eventos);
  desenhaSemDia(eventos);
}

/* ------------------------------------------------------------- grade --*/
const DIAS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

function desenhaGrade(mes, eventos){
  const doDia = new Map();
  for (const e of eventos){
    if (!doDia.has(e.data)) doDia.set(e.data, []);
    doDia.get(e.data).push(e);
  }
  const hoje = hojeISO();

  $("calGrade").innerHTML =
    '<div class="cal-cab">' + DIAS.map((d) => "<span>" + d + "</span>").join("") + "</div>"
    + gradeDoMes(mes).map((semana) =>
        '<div class="cal-semana">' + semana.map((d) => {
          const itens = doDia.get(d.data) || [];
          const marcas = itens.slice(0, 3).map((e) =>
            '<i class="pt e-' + esc(e.estado) + '" title="' + esc(e.titulo) + '"></i>').join("");
          return '<button type="button" class="cal-cel'
            + (d.noMes ? "" : " fora")
            + (d.data === hoje ? " hoje" : "")
            + (d.data === diaAberto ? " aberto" : "")
            + '" data-dia="' + esc(d.data) + '"'
            + ' aria-label="' + esc(diaLegivel(d.data)) + ", "
            + (itens.length ? itens.length + " eventos" : "nada") + '">'
            + '<span class="num">' + d.numero + "</span>"
            + '<span class="marcas">' + marcas
            + (itens.length > 3 ? '<i class="mais">+' + (itens.length - 3) + "</i>" : "")
            + "</span></button>";
        }).join("") + "</div>").join("");
}

/* ----------------------------------------------------------- agenda --*/
function desenhaAgenda(eventos){
  const dias = porDia(eventos);
  $("calAgenda").innerHTML = dias.length
    ? dias.map((d) =>
        '<section class="cal-bloco"><h3>' + esc(diaLegivel(d.data)) + "</h3>"
        + d.itens.map(linhaDeEvento).join("") + "</section>").join("")
    : '<p class="hint">Nada marcado neste mês. Aproveite.</p>';
}

/* ------------------------------------------------------- o dia aberto --*/
function desenhaDia(eventos){
  const alvo = $("calDia");
  if (!diaAberto){ alvo.hidden = true; alvo.innerHTML = ""; return; }
  const itens = eventos.filter((e) => e.data === diaAberto);
  alvo.hidden = false;
  alvo.innerHTML = '<h3 class="sub-titulo">' + esc(diaLegivel(diaAberto)) + "</h3>"
    + (itens.length ? itens.map(linhaDeEvento).join("")
                    : '<p class="hint">Nada neste dia.</p>');
}

/* Uma linha por ACONTECIMENTO. Quando o evento tem as duas datas e elas
   diferem, as duas aparecem -- "previsto 10, pago 12" é informação. */
function linhaDeEvento(e){
  const sinal = e.sentido === "entrada" ? "+" : "−";
  const quando = e.previstoEm && e.realizadoEm && e.previstoEm !== e.realizadoEm
    ? "previsto " + diaLegivel(e.previstoEm) + " · feito " + diaLegivel(e.realizadoEm)
    : "";
  const sub = [rotuloDoEstado(e.estado), quando, e.detalhe].filter(Boolean).join(" · ");
  return '<div class="cal-ev e-' + esc(e.estado) + '">'
    + '<span class="ico" aria-hidden="true">' + esc(iconeDoEstado(e.estado)) + "</span>"
    + '<span style="min-width:0"><span class="tit">' + esc(e.titulo) + "</span>"
    + '<span class="sub">' + esc(sub) + "</span></span>"
    + '<span class="vlr num">' + sinal + " " + money(e.valor) + "</span>"
    + "</div>";
}

/* O que existe no mês e NÃO tem dia. A V1 guarda dívida, fixa e receita por
   competência mensal, sem dia -- e escolher um dia para conta de dinheiro é
   inventar dado. Elas ficam numa lista própria, abaixo da grade, com o motivo
   escrito. Melhor uma lista honesta do que uma célula que mente. */
function desenhaSemDia(eventos){
  const alvo = $("calSemDia");
  if (!alvo) return;
  const soltos = semDiaCerto(eventos);
  alvo.hidden = soltos.length === 0;
  if (!soltos.length){ alvo.innerHTML = ""; return; }
  alvo.innerHTML = '<button type="button" class="cal-soltos-toggle" aria-expanded="'
    + String(semDiaAberto) + '" aria-controls="calSoltosLista">'
    + '<span>Sem dia definido <small>' + soltos.length + ' no mês</small></span>'
    + '<span aria-hidden="true">' + (semDiaAberto ? '−' : '+') + '</span></button>'
    + '<div id="calSoltosLista"' + (semDiaAberto ? '' : ' hidden') + '>'
    + '<p class="hint">Compromissos registrados somente por mês.</p>'
    + soltos.map(linhaDeEvento).join("") + '</div>';
}

export function ligaCalendario(){
  $("calSemDia")?.addEventListener("click", (e) => {
    if (!e.target.closest(".cal-soltos-toggle")) return;
    semDiaAberto = !semDiaAberto;
    const lista = $("calSoltosLista");
    lista.hidden = !semDiaAberto;
    const botao = e.target.closest(".cal-soltos-toggle");
    botao.setAttribute("aria-expanded", String(semDiaAberto));
    botao.lastElementChild.textContent = semDiaAberto ? '−' : '+';
  });
  $("btnVisaoMes")?.addEventListener("click", () => {
    visaoEscolhida = "mes"; renderCalendario();
  });
  $("btnVisaoAgenda")?.addEventListener("click", () => {
    visaoEscolhida = "agenda"; renderCalendario();
  });
  $("calGrade")?.addEventListener("click", (e) => {
    const cel = e.target.closest("[data-dia]");
    if (!cel) return;
    const d = cel.getAttribute("data-dia");
    /* clicar no dia aberto fecha: alternar é o que a pessoa espera de um
       detalhe que apareceu por clique */
    diaAberto = diaAberto === d ? null : d;
    renderCalendario();
  });
}
