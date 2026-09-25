/* A MATRIZ DE ROTAS · toda aba do registro, provada num navegador de verdade.
 *
 * POR QUE ESTE ARQUIVO EXISTE
 *
 * Duas classes de defeito escaparam de tudo o que o projeto tinha:
 *
 * 1. ESCOPO. `hojeISO` e `diaLegivel` moram em `v2-screens.js` e foram usados
 *    no `index.html` como se fossem globais. O JS compila, `checa-sintaxe`
 *    aprova, `checa-modulos` aprova -- e o navegador lança ReferenceError na
 *    hora em que aquele caminho roda. Aconteceu duas vezes no mesmo dia.
 *
 * 2. DUPLICIDADE DE DOM. `nav-grupos` existia no registro E escrito à mão no
 *    rodapé da lateral. O hook de HTML não pega, porque no arquivo o id
 *    aparece uma vez só: a segunda ocorrência nasce de `montaLateral()`, em
 *    tempo de execução.
 *
 * O que as duas têm em comum é que só existem com o app carregado. Então a
 * guarda também só pode viver aqui.
 *
 * A MATRIZ SAI DO REGISTRO, NUNCA DE UMA LISTA À MÃO
 *
 * Toda conferência abaixo percorre `ABAS`. Uma tela nova entra nesta prova
 * sozinha, no commit em que for registrada -- e é isso que impede o teste de
 * envelhecer e passar a provar menos do que aparenta. Lista manual em teste de
 * navegação é a mesma doença que este arquivo existe para curar.
 *
 * Roda: `node testes/rotas.mjs`. Com SERVIR_ARTEFATO=1, contra o artefato.
 */
import { exigeNavegador } from "./navegador.mjs";
exigeNavegador("rotas");
const { abreApp, fechaNavegador, RAIZ } = await import("./navegador.mjs");
const { ABAS, abasDoRodape, abasDoMais } = await import("../js/ui/navigation.js");
const { dependenciasDoSite } = await import("../ferramentas/artefato.mjs");

let ok = 0, bad = 0;
const eq = (nome, got, want) => {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a === b) ok++;
  else { bad++; console.error(`  ✗ ${nome}\n      esperado ${b}\n      obtido   ${a}`); }
};

/* Erros de página são o produto principal deste arquivo, não um detalhe: é por
   eles que um defeito de escopo aparece. Conferidos depois de CADA passo, e não
   só no fim -- saber QUAL aba quebrou vale mais do que saber que algo quebrou. */
const semErros = (rotulo, erros) => {
  if (erros.length === 0){ ok++; return; }
  bad++;
  console.error(`  ✗ ${rotulo} produziu erro no navegador:`);
  for (const e of erros.slice(0, 4)) console.error(`      ${e}`);
};

/* ==================================================================
   1. A LATERAL DO DESKTOP: cada aba UMA vez, e só abas
   ================================================================== */
console.log("1. lateral do desktop: uma entrada por aba");
{
  const { p, erros } = await abreApp(1440);

  /* querySelectorAll, NÃO getElementById: o segundo devolve o primeiro e
     esconde exatamente o defeito que se quer pegar. Foi assim que o botão
     duplicado de Grupos passou despercebido -- ele existia, visível, e o
     ouvinte de clique tinha ido para o outro. */
  const contagem = await p.evaluate((ids) => Object.fromEntries(
    ids.map((id) => [id, document.querySelectorAll('[id="nav-' + id + '"]').length])),
    ABAS.map((a) => a.id));
  for (const a of ABAS)
    eq(`"${a.rotulo}" tem exatamente um botão nav-${a.id} no DOM`, contagem[a.id], 1);

  /* A mesma pergunta pelo outro lado: nenhum id de aba repetido em lugar
     nenhum do documento, venha do HTML ou de quem montou a lateral. */
  eq("nenhum id duplicado no documento inteiro",
    await p.evaluate(() => {
      const vistos = new Set(), repetidos = [];
      for (const el of document.querySelectorAll("[id]")){
        if (vistos.has(el.id)) repetidos.push(el.id);
        vistos.add(el.id);
      }
      return repetidos.sort();
    }), []);

  /* Perfil é aberto pelo bloco com foto e nome. No rodapé sobra somente Ajustes:
     repetir Usuário aqui criaria dois caminhos vizinhos para o mesmo destino. */
  eq("o rodapé da lateral contém somente Ajustes",
    await p.evaluate(() => [...document.querySelectorAll(".lateral .rodape [id^='nav-']")]
      .map((b) => b.id).sort()), ["nav-ajustes"]);

  /* E o <nav> tem exatamente as abas do registro que não são CONFIGURAÇÕES,
     na ordem do registro: a lateral é o registro desenhado, ou não é nada. */
  eq("o <nav> da lateral é o registro, na ordem, sem CONFIGURAÇÕES",
    await p.evaluate(() => [...document.querySelectorAll(".lateral nav [id^='nav-']")]
      .map((b) => b.id.slice(4))),
    ABAS.filter((a) => a.grupo !== "CONFIGURAÇÕES").map((a) => a.id));

  semErros("abrir o app em 1440px", erros);
  await p.close();
}

/* ==================================================================
   2. CADA ABA ABRE: painel certo visível, todos os outros escondidos
   ================================================================== */
console.log("\n2. cada aba do registro abre");
{
  const { p, erros } = await abreApp(1440);
  semErros("carregar o app", erros);

  for (const a of ABAS){
    const antes = erros.length;
    const estado = await p.evaluate((id) => {
      const botao = id === "perfil"
        ? document.getElementById("perfilResumoLateral")
        : document.getElementById("nav-" + id);
      if (!botao) return { faltou: "acesso para " + id };
      botao.click();
      const painel = document.getElementById("p-" + id);
      if (!painel) return { faltou: "painel p-" + id };
      return {
        visivel: !painel.hidden,
        marcado: botao.getAttribute("aria-selected"),
        /* ninguém mais pode estar aberto ao mesmo tempo */
        outrosAbertos: [...document.querySelectorAll("section.panel[id^='p-']")]
          .filter((s) => s.id !== "p-" + id && !s.hidden).map((s) => s.id),
      };
    }, a.id);
    await p.waitForTimeout(220);

    eq(`${a.id}: painel e botão existem`, estado.faltou || null, null);
    eq(`${a.id}: o painel fica visível`, estado.visivel, true);
    eq(`${a.id}: o acesso reflete a seleção`, estado.marcado, a.id === "perfil" ? null : "true");
    eq(`${a.id}: nenhum outro painel fica aberto junto`, estado.outrosAbertos, []);
    /* ReferenceError e TypeError de escopo aparecem AQUI, ao abrir a tela --
       não no carregamento, porque o módulo importa sem erro. */
    semErros(`abrir a aba ${a.id}`, erros.slice(antes));
  }
  await p.close();
}

/* ==================================================================
   3. O CELULAR: quatro no rodapé, o resto atrás do "Mais"
   ================================================================== */
console.log("\n3. celular: rodapé e folha Mais");
{
  const { p, erros } = await abreApp(390);
  semErros("carregar o app em 390px", erros);

  eq("o rodapé tem no máximo quatro abas mais o botão Mais",
    await p.evaluate(() => [...document.querySelectorAll("nav.rodapenav .navitem")].map((b) => b.id)),
    [...abasDoRodape().map((a) => "navm-" + a.id), "navm-mais"]);

  /* Toda aba que NÃO está no rodapé precisa ser alcançável pela folha. Uma
     tela registrada sem lugar no celular é uma tela que não existe no
     celular, e isso não pode passar em silêncio. */
  await p.evaluate(() => document.getElementById("navm-mais").click());
  await p.waitForTimeout(250);
  eq("a folha Mais lista exatamente as abas que não estão no rodapé",
    await p.evaluate(() => [...document.querySelectorAll("#folhaOpcoes [id^='navs-']")]
      .map((b) => b.id.slice(5))), abasDoMais().map((a) => a.id));

  /* e clicar numa delas realmente troca de aba e fecha a folha */
  const alvo = abasDoMais()[0];
  const depois = await p.evaluate((id) => {
    document.getElementById("navs-" + id).click();
    return { aberta: !document.getElementById("p-" + id).hidden };
  }, alvo.id);
  eq(`abrir "${alvo.rotulo}" pela folha leva à aba`, depois.aberta, true);
  await p.waitForFunction(() => !document.getElementById("folhaMais").open);
  eq("e a folha se fecha ao escolher", await p.evaluate(() => !document.getElementById("folhaMais").open), true);

  semErros("navegar pelo celular", erros);
  await p.close();
}

/* ==================================================================
   4. TODO MÓDULO DO SITE CARREGA NO NAVEGADOR
   ================================================================== */
/* A guarda contra import quebrado e export que sumiu. Ela roda no navegador,
   e não em Node, de propósito: é o resolvedor do navegador que decide se
   `./x.js` existe, e é ele que precisa aprovar.

   A lista vem do grafo de dependência real -- o mesmo que o artefato usa --,
   então um módulo novo entra nesta prova sem ninguém acrescentar linha. */
console.log("\n4. todo módulo do site carrega");
{
  const { p, erros } = await abreApp(1440);
  const modulos = dependenciasDoSite(RAIZ).alcancados.filter((r) => r.endsWith(".js"));

  const falhas = await p.evaluate(async (lista) => {
    const ruins = [];
    for (const rel of lista){
      try { await import("/" + rel); }
      catch (e){ ruins.push(rel + ": " + String(e).slice(0, 120)); }
    }
    return ruins;
  }, modulos);

  eq(`os ${modulos.length} módulos do site importam sem erro`, falhas, []);
  semErros("importar todos os módulos", erros);
  await p.close();
}

await fechaNavegador();
console.log(`\n${ok} passaram, ${bad} falharam`);
process.exit(bad ? 1 : 0);
