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
        - (barra.classList.contains("rodapenav")
          ? item.getBoundingClientRect().left - barra.getBoundingClientRect().left + 7
          : item.getBoundingClientRect().left - barra.getBoundingClientRect().left + 4)) < 2,
      contida:parseFloat(barra.style.getPropertyValue("--lens-left")) >= 0
        && parseFloat(barra.style.getPropertyValue("--lens-left")) + parseFloat(barra.style.getPropertyValue("--lens-width")) <= barra.clientWidth
        && parseFloat(barra.style.getPropertyValue("--lens-top")) + parseFloat(barra.style.getPropertyValue("--lens-height")) <= barra.clientHeight,
      proporcional:!barra.classList.contains("rodapenav")
        || (Math.abs(parseFloat(barra.style.getPropertyValue("--lens-width")) - item.getBoundingClientRect().width + 14) < 1
          && Math.abs(parseFloat(barra.style.getPropertyValue("--lens-height")) - barra.getBoundingClientRect().height + 14) < 1
          && Math.abs(parseFloat(barra.style.getPropertyValue("--lens-top")) - 7) < 1),
      soIcones:!barra.classList.contains("rodapenav") || [...barra.querySelectorAll(".navitem")].every((botao) => {
        const rotulo = botao.querySelector("span"), estilo = getComputedStyle(rotulo);
        return estilo.width === "1px" && estilo.position === "absolute" && botao.querySelector("svg")?.getBoundingClientRect().width >= 24;
      }),
      clara:!barra.classList.contains("rodapenav") || getComputedStyle(barra).backgroundImage.includes("rgba(255, 255, 255"),
      transparente:!barra.classList.contains("rodapenav") || Number(getComputedStyle(barra).backgroundColor.match(/[\d.]+/g)[3]) <= .2,
      bordasIguais:!barra.classList.contains("rodapenav") || Math.abs(parseFloat(barra.style.getPropertyValue("--lens-top"))
        - (barra.getBoundingClientRect().height - parseFloat(barra.style.getPropertyValue("--lens-top"))
          - parseFloat(barra.style.getPropertyValue("--lens-height")))) < 1,
      vidroForte:!barra.classList.contains("rodapenav") || parseFloat(getComputedStyle(barra).backdropFilter.match(/blur\(([\d.]+)px\)/)?.[1]) >= 20,
      vidro:vidro.backdropFilter !== "none" || vidro.webkitBackdropFilter !== "none",
      brilho:brilho.opacity,
      transicao:vidro.transitionDuration,
      overflow:document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  }, { nav, alvo });
  if (visual.selecionado !== "true" || !visual.alinhado || !visual.contida || !visual.proporcional || !visual.soIcones || !visual.clara || !visual.transparente || !visual.bordasIguais || !visual.vidroForte || !visual.vidro
      || visual.brilho !== "1" || visual.overflow > 1)
    falhas.push(`${largura}px: ${JSON.stringify(visual)}`);

  if (!movel){
    await p.locator("#nav-contas").hover();
    await p.locator("#nav-contas").focus();
    const focoEstavel = await p.evaluate(() => {
      const barra=document.querySelector(".lateral nav");
      return document.getElementById("nav-mes").classList.contains("glass-focused")
        && !document.getElementById("nav-contas").classList.contains("glass-focused")
        && barra.style.getPropertyValue("--lens-opacity") === "1";
    });
    if (!focoEstavel) falhas.push("desktop: passar o mouse ou focar outra aba tirou o destaque da selecionada");
    for (const tema of ["claro","escuro"]){
      await p.evaluate((tema) => { document.documentElement.dataset.tema = tema; document.getElementById("nav-grupos").click(); }, tema);
      await p.waitForTimeout(370);
      const lateral = await p.evaluate(() => {
        const painel = document.querySelector(".lateral"), barra = painel.querySelector("nav"), item = document.getElementById("nav-grupos");
        const caixa = barra.getBoundingClientRect(), alvo = item.getBoundingClientRect(), lente = getComputedStyle(barra,"::before");
        return { ativo:item.getAttribute("aria-selected"), alinhada:Math.abs(caixa.top + parseFloat(barra.style.getPropertyValue("--lens-top")) - alvo.top - 2) < 2,
          largura:parseFloat(barra.style.getPropertyValue("--lens-width")), esperada:alvo.width - 8,
          altura:parseFloat(barra.style.getPropertyValue("--lens-height")), alturaEsperada:alvo.height - 4,
          semGlare:getComputedStyle(barra,"::after").display === "none" && lente.backdropFilter === "none" && lente.boxShadow.split(",").length === 4,
          semTrilho:getComputedStyle(painel).scrollbarWidth === "none" };
      });
      if (lateral.ativo !== "true" || !lateral.alinhada || Math.abs(lateral.largura-lateral.esperada) > 1
        || Math.abs(lateral.altura-lateral.alturaEsperada) > 1 || !lateral.semGlare || !lateral.semTrilho)
        falhas.push(`desktop ${tema}: ${JSON.stringify(lateral)}`);
    }
    await p.setViewportSize({width:largura,height:620});
    await p.locator("#btnTema").hover();
    const rolagem = await p.evaluate(() => document.querySelector(".lateral").scrollTop);
    await p.locator("#btnAtualizar").hover();
    const fundoEstavel = await p.evaluate(() => ({
      rolagem:document.querySelector(".lateral").scrollTop,
      ativo:document.getElementById("nav-grupos").classList.contains("glass-focused"),
      lente:document.querySelector(".lateral nav").style.getPropertyValue("--lens-opacity"),
    }));
    if (rolagem < 20 || fundoEstavel.rolagem < 20 || !fundoEstavel.ativo || fundoEstavel.lente !== "1")
      falhas.push(`desktop: hover no rodapé alterou a seleção ou a rolagem (${JSON.stringify(fundoEstavel)})`);
    await p.locator("#nav-ajustes").click();
    await p.waitForTimeout(60);
    const ajustes = await p.evaluate(() => ({
      selecionado:document.getElementById("nav-ajustes").getAttribute("aria-selected"),
      lente:document.querySelector(".lateral nav").style.getPropertyValue("--lens-opacity"),
      foco:!!document.querySelector(".lateral nav .glass-focused"),
    }));
    if (ajustes.selecionado !== "true" || ajustes.lente !== "0" || ajustes.foco)
      falhas.push(`desktop: Ajustes deixou lente antiga na lista (${JSON.stringify(ajustes)})`);
    await p.locator("#btnTema").hover();
    if (await p.locator(".lateral nav").evaluate((nav) => nav.style.getPropertyValue("--lens-opacity")) !== "0")
      falhas.push("desktop: hover no rodapé ressuscitou lente da lista");
    await p.locator("#nav-painel").click();
    await p.waitForTimeout(60);
    if (await p.locator(".lateral nav").evaluate((nav) => nav.style.getPropertyValue("--lens-opacity")) !== "1")
      falhas.push("desktop: voltar à lista não restaurou a lente");
    await p.locator("#btnTema").hover();
    await p.waitForTimeout(60);
    const foraDaVista = await p.evaluate(() => ({
      rolagem:document.querySelector(".lateral").scrollTop,
      ativo:document.getElementById("nav-painel").getAttribute("aria-selected"),
      lente:document.querySelector(".lateral nav").style.getPropertyValue("--lens-opacity"),
    }));
    if (foraDaVista.rolagem < 20 || foraDaVista.ativo !== "true" || foraDaVista.lente !== "0")
      falhas.push(`desktop: lente recortada quando a aba ativa saiu da vista (${JSON.stringify(foraDaVista)})`);
    await p.locator("#nav-painel").hover();
    await p.waitForTimeout(60);
    if (await p.locator(".lateral nav").evaluate((nav) => nav.style.getPropertyValue("--lens-opacity")) !== "1")
      falhas.push("desktop: lente não reapareceu ao voltar à aba ativa");
  }
  if (movel){
    const de = await p.locator("#navm-mes").boundingBox();
    const para = await p.locator("#navm-transacoes").boundingBox();
    await p.mouse.move(de.x + de.width / 2,de.y + de.height / 2);
    await p.mouse.down();
    await p.mouse.move(para.x + para.width / 2,para.y + para.height / 2,{steps:12});
    const durante = await p.evaluate(() => {
      const nav = document.querySelector("nav.rodapenav");
      return {arrastando:nav.classList.contains("lens-dragging"),
        esquerda:parseFloat(nav.style.getPropertyValue("--lens-left")),
        largura:parseFloat(nav.style.getPropertyValue("--lens-width")),
        barra:nav.clientWidth};
    });
    await p.mouse.up();
    await p.waitForTimeout(460);
    const selecionado = await p.locator("#navm-transacoes").getAttribute("aria-selected");
    if (!durante.arrastando || durante.esquerda < 0 || durante.esquerda + durante.largura > durante.barra || selecionado !== "true")
      falhas.push(`${largura}px: arraste falhou (${JSON.stringify(durante)}, selecionado=${selecionado})`);
    await p.mouse.move(para.x + para.width / 2,para.y + para.height / 2);
    await p.mouse.down();
    await p.mouse.move(de.x + de.width / 2,de.y + de.height / 2,{steps:10});
    await p.mouse.up();
    if (await p.locator("#navm-mes").getAttribute("aria-selected") !== "true")
      falhas.push(`${largura}px: arraste de volta não selecionou Calendário`);
    if (largura === 390){
      const cdp = await p.context().newCDPSession(p);
      const y = de.y + de.height / 2;
      await cdp.send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[{x:de.x + de.width / 2,y,id:1}]});
      for (let i=1;i<=8;i++) await cdp.send("Input.dispatchTouchEvent",{type:"touchMove",touchPoints:[{x:de.x + de.width / 2 + (para.x + para.width / 2 - de.x - de.width / 2)*i/8,y,id:1}]});
      await cdp.send("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]});
      await p.waitForTimeout(470);
      if (await p.locator("#navm-transacoes").getAttribute("aria-selected") !== "true")
        falhas.push("390px: gesto de toque não selecionou Transações");
      await cdp.detach();
      await p.locator("#navm-painel").click();
      await p.evaluate(() => {
        const hero = document.querySelector("#painelV2");
        hero.hidden = false;
        hero.style.marginTop = "180px";
      });
      await p.waitForTimeout(120);
      const sobreEscuro = await p.locator("nav.rodapenav").evaluate((barra) => ({
        itens:[...barra.querySelectorAll(".navitem")].every((item) => item.classList.contains("sobre-escuro") && getComputedStyle(item).color === "rgb(244, 255, 248)"),
        lente:barra.classList.contains("lente-sobre-escuro"),
      }));
      if (!sobreEscuro.itens || !sobreEscuro.lente)
        falhas.push(`390px: ícones não clarearam sobre o cartão escuro (${JSON.stringify(sobreEscuro)})`);
      await p.evaluate(() => document.querySelector("#painelV2").hidden = true);
      await p.waitForTimeout(120);
      if (await p.locator("nav.rodapenav").evaluate((barra) => barra.classList.contains("lente-sobre-escuro")
          || [...barra.querySelectorAll(".navitem")].some((item) => item.classList.contains("sobre-escuro"))))
        falhas.push("390px: a barra não voltou às cores de fundo claro");
      await p.evaluate(() => document.documentElement.dataset.tema = "escuro");
      await p.waitForTimeout(380);
      const escuro = await p.locator("nav.rodapenav").evaluate((barra) => ({
        alpha:Number(getComputedStyle(barra).backgroundColor.match(/[\d.]+/g)[3]),
        tinta:getComputedStyle(barra.querySelector('.navitem[aria-selected="true"]')).color,
        lente:getComputedStyle(barra,"::before").backgroundColor,
      }));
      if (escuro.alpha > .2 || escuro.tinta !== "rgb(255, 255, 255)" || escuro.lente !== "rgba(0, 0, 0, 0)")
        falhas.push(`390px: vidro escuro sem transparência ou contraste (${JSON.stringify(escuro)})`);
    }
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
