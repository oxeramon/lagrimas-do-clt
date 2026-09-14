/* AS PEÇAS DE INTERFACE QUE MAIS DE UMA TELA USA.
 *
 * Não é um `utils.js`: aqui só entra peça de INTERFACE com convenção própria do
 * produto -- o selo de instituição, a exclusão em dois cliques, o campo de erro,
 * o pirulito. São decisões de desenho que precisam sair iguais em toda tela, e
 * é por isso que moram juntas.
 *
 * O que NÃO entra: regra financeira (mora em `js/domain/`), leitura de estado
 * (mora em `estado.js`) e qualquer função que só uma tela chame.
 */
import { esc } from "../../core/escape.js";
import { money } from "../../core/money.js";
import { MES_LONGO, iso } from "../../core/dates.js";
import { monogramaDe, contrasteSobre } from "../institution-catalog.js";

/* HOJE é o mês corrente EM TEXTO ("2026-09"), não um Date. Para a data de hoje
   em ISO quem serve é iso(new Date()) -- e foi por confundir os dois que este
   código já derrubou o módulo inteiro no import. */
export const hojeISO = () => iso(new Date());

export const dinheiro = (v) => (v === null || v === undefined ? "—" : money(v));


/* O selo é monograma por padrão. Logo só quando a pessoa cadastrou uma URL, e
   mesmo assim com `onerror` voltando ao monograma -- CDN fora do ar não pode
   deixar buraco na tela. */
export function selo(nome, cor, logo){
  const c = cor || "#1A6459";
  const estilo = `--marca:${esc(c)};--marca-ink:${contrasteSobre(c)}`;
  const mono = esc(monogramaDe(nome));
  const img = logo
    ? `<img src="${esc(logo)}" alt="" loading="lazy" onerror="this.remove()">`
    : "";
  return `<span class="selo" style="${estilo}" aria-hidden="true">${mono}${img}</span>`;
}

export function listaDeOpcoes(lista, selecionado, vazio){
  const cab = vazio ? `<option value="">${esc(vazio)}</option>` : "";
  return cab + lista.map((o) =>
    `<option value="${esc(o.id)}"${o.id === selecionado ? " selected" : ""}>${esc(o.rotulo)}</option>`
  ).join("");
}

/* Dois cliques no mesmo botão, e volta sozinho em 4s. Igual ao resto do app:
   `confirm()` do navegador não combina com nada e é fácil de errar sem ler. */
export function confirmaEmDoisCliques(botao, rotuloNormal, aoConfirmar, rotuloArmado){
  const confirmar = rotuloArmado || "Confirmar exclusão";
  let armado = false, relogio = null;
  botao.addEventListener("click", async () => {
    if (!armado){
      armado = true;
      botao.textContent = confirmar;
      botao.classList.add("perigo");
      relogio = setTimeout(() => {
        armado = false; botao.textContent = rotuloNormal; botao.classList.remove("perigo");
      }, 4000);
      return;
    }
    clearTimeout(relogio);
    armado = false; botao.textContent = rotuloNormal; botao.classList.remove("perigo");
    await aoConfirmar();
  });
}

export const mostraErro = (el, texto) => {
  if (!el) return;
  el.textContent = texto || "";
  el.hidden = !texto;
};

export function pirulitos(alvo, itens){
  if (!alvo) return;
  if (!itens.length){ alvo.innerHTML = '<li class="pirulito"><span class="rot">Nada por aqui ainda</span></li>'; return; }
  const teto = Math.max(...itens.map((i) => Math.abs(i.valor)), 1);
  alvo.innerHTML = itens.map((i) => {
    const frac = Math.round((Math.abs(i.valor) / teto) * 100);
    const cor = i.cor ? `--cor:${esc(i.cor)};` : "";
    return `<li class="pirulito" style="${cor}--frac:${frac}%">
      <span class="rot" title="${esc(i.rotulo)}">${esc(i.rotulo)}</span>
      <span class="talo"><span class="haste"></span><span class="bola"></span></span>
      <span class="val">${money(i.valor)}</span></li>`;
  }).join("");
}


export function diaLegivel(d){
  const [a, m, dd] = d.split("-");
  return dd + " de " + MES_LONGO[Number(m) - 1];
}

