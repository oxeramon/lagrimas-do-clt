#!/usr/bin/env node
/* Confere a estrutura do HTML do index.html.
 *
 * Existe porque o checa-sintaxe.mjs só olha o JavaScript, e um HTML mal
 * fechado não é erro de sintaxe de JS: passa pelo `node --check`, passa pelos
 * testes, e só aparece quando a tela renderiza torta. Aconteceu duas vezes --
 * um </div> comido ao mexer num campo deixou a Categoria sem fechar, e o
 * formulário inteiro escorregou para dentro dela.
 *
 * O que ele confere:
 *   1. toda tag aberta fecha, na ordem certa
 *   2. nenhum id repetido, porque $("x") devolveria só o primeiro
 */
import { readFileSync } from "node:fs";
import { basename } from "node:path";

let entrada = "";
process.stdin.on("data", (c) => (entrada += c));
process.stdin.on("end", () => {
  let dados = {};
  try { dados = JSON.parse(entrada || "{}"); } catch { process.exit(0); }

  const caminho = dados?.tool_response?.filePath || dados?.tool_input?.file_path;
  if (!caminho || basename(caminho) !== "index.html") process.exit(0);

  let fonte = "";
  try { fonte = readFileSync(caminho, "utf8").replace(/\r\n/g, "\n"); } catch { process.exit(0); }

  const problemas = [];
  const linhaDe = (i) => fonte.slice(0, i).split("\n").length;

  /* Só o HTML de verdade entra na conta. O <script> monta HTML em string --
     '<div class="row">' aparece ali dentro o tempo todo -- e o <style> tem
     data-URI com '<svg'. Contar esses pedaços daria alarme falso. Os blocos
     são trocados por espaços em branco do mesmo tamanho, para os números de
     linha continuarem valendo. */
  const vazio = (txt) => txt.replace(/[^\n]/g, " ");
  const html = fonte
    .replace(/(<script\b[^>]*>)([\s\S]*?)(<\/script>)/gi, (_, a, m, z) => a + vazio(m) + z)
    .replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi, (_, a, m, z) => a + vazio(m) + z)
    .replace(/<!--[\s\S]*?-->/g, vazio);

  /* ---- 1. balanço das tags ------------------------------------------- */
  const VAZIAS = new Set(["area", "base", "br", "col", "embed", "hr", "img",
    "input", "link", "meta", "param", "source", "track", "wbr"]);

  /* as aspas no meio do atributo protegem um '>' que não fecha tag nenhuma,
     como em aria-label="maior > menor" */
  const TAG = /<(\/?)([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g;

  /* "<div> da linha 1028" manda procurar numa linha e torcer. Com a classe ou
     o id junto, dá para achar pelo nome: quando falta um fechamento, o erro só
     aparece lá no fim, longe de onde o estrago foi feito. */
  const apelido = (nome, attrs) => {
    const id = /\bid="([^"]+)"/.exec(attrs || "");
    if (id) return `<${nome} id="${id[1]}">`;
    const cls = /\bclass="([^"]+)"/.exec(attrs || "");
    if (cls) return `<${nome} class="${cls[1].split(/\s+/)[0]}">`;
    return `<${nome}>`;
  };

  const pilha = [];
  for (const m of html.matchAll(TAG)) {
    const fecha = m[1] === "/";
    const nome = m[2].toLowerCase();
    const autoFecha = m[4] === "/";
    if (VAZIAS.has(nome) || autoFecha) continue;

    if (!fecha) { pilha.push({ nome, i: m.index, sinal: apelido(nome, m[3]) }); continue; }

    if (!pilha.length) {
      problemas.push(`Linha ${linhaDe(m.index)}: </${nome}> fecha uma tag que nunca foi aberta.`);
      continue;
    }
    const topo = pilha[pilha.length - 1];
    if (topo.nome === nome) { pilha.pop(); continue; }

    /* fechou a errada: ou falta um fechamento no meio, ou sobra este */
    const antes = pilha.map((x) => x.nome).lastIndexOf(nome);
    if (antes === -1) {
      problemas.push(
        `Linha ${linhaDe(m.index)}: </${nome}> não casa com nada — a tag aberta `
        + `no momento é ${topo.sinal}, da linha ${linhaDe(topo.i)}.`);
    } else {
      const perdidas = pilha.slice(antes + 1)
        .map((x) => `${x.sinal} da linha ${linhaDe(x.i)}`);
      problemas.push(
        `Linha ${linhaDe(m.index)}: </${nome}> fecha antes da hora. Falta fechar `
        + perdidas.join(", ") + ".");
      pilha.length = antes;
    }
  }
  for (const x of pilha) {
    problemas.push(`Linha ${linhaDe(x.i)}: ${x.sinal} abre e nunca fecha.`);
  }

  /* ---- 2. id repetido -------------------------------------------------- */
  const vistos = new Map();
  for (const m of html.matchAll(/\bid="([^"]+)"/g)) {
    const id = m[1];
    if (vistos.has(id)) {
      problemas.push(
        `Linha ${linhaDe(m.index)}: o id "${id}" já existe na linha ${linhaDe(vistos.get(id))}. `
        + `$("${id}") devolveria sempre o primeiro, e o segundo elemento ficaria morto.`);
    } else vistos.set(id, m.index);
  }

  if (!problemas.length) process.exit(0);

  /* uma lista longa some na tela; as primeiras já dizem onde está o estrago */
  const mostra = problemas.slice(0, 8);
  const resto = problemas.length - mostra.length;
  process.stdout.write(JSON.stringify({
    decision: "block",
    reason: "O HTML do index.html está malformado. Isso não é erro de sintaxe de "
      + "JavaScript, então o node --check e os testes passam do mesmo jeito — a "
      + "tela é que renderiza torta:\n\n"
      + mostra.map((p) => "• " + p).join("\n")
      + (resto > 0 ? `\n\n…e mais ${resto}.` : ""),
  }));
});
