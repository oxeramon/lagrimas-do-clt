/* A lente precisa acompanhar o toque e o foco sem perder contraste ou causar overflow. */
import { exigeNavegador } from "./navegador.mjs";
exigeNavegador("liquid-glass");
const { abreApp, fechaNavegador } = await import("./navegador.mjs");

const falhas = [];
for (const largura of [1440, 390, 320]){
  const { p, erros } = await abreApp(largura);
  const movel = largura <= 900;
  const nav = movel ? "nav.rodapenav" : ".lateral nav[role='tablist']";
  const alvo = movel ? "#navm-mes" : "#nav-mes";
  await p.locator(alvo).click();
  await p.waitForTimeout(620);
  const visual = await p.evaluate(({ nav, alvo }) => {
    const barra = document.querySelector(nav), item = document.querySelector(alvo);
    const vidro = getComputedStyle(barra, "::before");
    const brilho = getComputedStyle(barra, "::after");
    return {
      selecionado:item.getAttribute("aria-selected"),
      alinhado:Math.abs(parseFloat(barra.style.getPropertyValue("--lens-left"))
        - (item.getBoundingClientRect().left - barra.getBoundingClientRect().left)) < 2,
      vidro:vidro.backdropFilter !== "none" || vidro.webkitBackdropFilter !== "none",
      brilho:brilho.opacity,
      transicao:vidro.transitionDuration,
      overflow:document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  }, { nav, alvo });
  if (visual.selecionado !== "true" || !visual.alinhado || !visual.vidro
      || visual.brilho !== "1" || visual.overflow > 1)
    falhas.push(`${largura}px: ${JSON.stringify(visual)}`);

  if (!movel){
    await p.locator("#nav-contas").hover();
    const focado = await p.locator("#nav-contas").evaluate((el) => el.classList.contains("glass-focused"));
    if (!focado) falhas.push("desktop: a lente não acompanha o ponteiro");
  }
  await p.emulateMedia({ reducedMotion:"reduce" });
  const duracao = await p.evaluate((nav) => getComputedStyle(document.querySelector(nav), "::before").transitionDuration, nav);
  if (!duracao.split(",").every((x) => parseFloat(x) === 0))
    falhas.push(`${largura}px: movimento reduzido não respeitado (${duracao})`);
  if (erros.length) falhas.push(`${largura}px: ${erros.join(" | ")}`);
  await p.close();
}
await fechaNavegador();
if (falhas.length){ console.error(falhas.join("\n")); process.exitCode = 1; }
else console.log("Liquid glass validado em desktop, mobile e movimento reduzido.");

