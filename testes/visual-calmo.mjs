/* Verifica a reformulação em todas as abas com dados sintéticos.
   CHROMIUM_PATH=<navegador> node testes/visual-calmo.mjs */
import { exigeNavegador } from "./navegador.mjs";
exigeNavegador("visual-calmo");
const { abreApp, fechaNavegador } = await import("./navegador.mjs");
const { ABAS } = await import("../js/ui/navigation.js");

const falhas = [];
for (const largura of [1440, 900, 600, 390, 320]){
  const { p, erros } = await abreApp(largura);
  for (const aba of ABAS){
    await p.evaluate((id) => document.getElementById(`nav-${id}`).click(), aba.id);
    await p.waitForTimeout(80);
    const resultado = await p.evaluate((id) => {
      const painel = document.getElementById(`p-${id}`);
      const movel = innerWidth <= 900;
      const nav = document.querySelector(movel ? ".rodapenav" : ".lateral nav");
      const ativo = movel
        ? document.querySelector('.rodapenav .navitem[aria-selected="true"]')
        : nav.querySelector('.navitem[aria-selected="true"]');
      const lente = getComputedStyle(nav, "::before");
      const x = parseFloat(nav.style.getPropertyValue("--lens-left"));
      const alvo = ativo?.getBoundingClientRect();
      const caixa = nav.getBoundingClientRect();
      return {
        painel: !painel.hidden,
        largura: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        lente: !ativo || (lente.opacity === "1" && Math.abs(x - (alvo.left - caixa.left)) < 2),
      };
    }, aba.id);
    if (!resultado.painel || resultado.largura > 1 || !resultado.lente)
      falhas.push(`${largura}px ${aba.id}: ${JSON.stringify(resultado)}`);
  }
  if (largura === 390){
    await p.locator("#navm-mais").click();
    await p.waitForTimeout(400);
    const folha = await p.evaluate(() => {
      const corpo = document.querySelector(".folha .corpo");
      const r = corpo.getBoundingClientRect();
      return { aberta:corpo.closest("dialog").open, topo:r.top, base:r.bottom, altura:innerHeight };
    });
    if (!folha.aberta || folha.topo < 0 || folha.base > folha.altura)
      falhas.push(`${largura}px folha Mais: ${JSON.stringify(folha)}`);
  }
  if (erros.length) falhas.push(`${largura}px: erros JS ${erros.join("; ")}`);
  await p.close();
  console.log(`${largura}px: ${ABAS.length} abas verificadas`);
}
await fechaNavegador();
if (falhas.length){
  console.error(falhas.join("\n"));
  process.exitCode = 1;
} else console.log("Visual Calmo: nenhuma aba com rolagem lateral ou seleção perdida.");
