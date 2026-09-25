/* Confirma as duas etapas antes de apagar um grupo com membros e rateio. */
import { exigeNavegador } from "./navegador.mjs";
exigeNavegador("exclusao-grupo-ui");
const { abreApp, vaiPara, fechaNavegador } = await import("./navegador.mjs");

const falhas = [];
for (const largura of [1440, 390]){
  const { p, erros } = await abreApp(largura);
  await p.evaluate(() => {
    __T.grupos = [{ id:"grupo-teste", nome:"Viagem teste", obs:"", ordem:0 }];
    __T.membros = [
      { id:"pessoa-1", grupo_id:"grupo-teste", nome:"Eu", sou_eu:true, ativo:true },
      { id:"pessoa-2", grupo_id:"grupo-teste", nome:"Outra pessoa", sou_eu:false, ativo:true },
    ];
    __T.despesas_do_grupo = [{ id:"despesa-1", grupo_id:"grupo-teste",
      pago_por_id:"pessoa-1", descricao:"Almoço", valor:40, data:"2026-09-24" }];
    __salvaDuble();
  });
  await p.reload({ waitUntil:"networkidle" });
  await vaiPara(p, "grupos");
  await p.locator("#btnEditarGrupo").click();
  await p.locator("#gpExcluir").click();
  if (!await p.locator("#dlgExcluirGrupo").evaluate((d) => d.open))
    falhas.push(`${largura}px: primeira confirmação não abriu`);
  if (!await p.locator("#gpExEtapa").textContent().then((s) => s.includes("1 de 2")))
    falhas.push(`${largura}px: etapa inicial incorreta`);
  await p.locator("#gpExConfirmar").click();
  if (!await p.locator("#gpExEtapa").textContent().then((s) => s.includes("2 de 2")))
    falhas.push(`${largura}px: segunda confirmação não apareceu`);
  if (!await p.evaluate(() => __T.grupos.some((g) => g.id === "grupo-teste")))
    falhas.push(`${largura}px: excluiu antes da confirmação final`);
  await p.locator('#dlgExcluirGrupo [data-fechar="dlgExcluirGrupo"]').last().click();
  if (await p.locator("#dlgExcluirGrupo").evaluate((d) => d.open))
    falhas.push(`${largura}px: cancelar não fechou o aviso`);
  await p.locator("#gpExcluir").click();
  await p.locator("#gpExConfirmar").click();
  await p.locator("#gpExConfirmar").click();
  await p.waitForTimeout(150);
  if (await p.evaluate(() => __T.grupos.some((g) => g.id === "grupo-teste")))
    falhas.push(`${largura}px: não excluiu após duas confirmações`);
  if (erros.length) falhas.push(`${largura}px: ${erros.join(" | ")}`);
  await p.close();
}
await fechaNavegador();
if (falhas.length){ console.error(falhas.join("\n")); process.exitCode = 1; }
else console.log("Exclusão de grupo: duas confirmações e cancelamento verificados em desktop e celular.");

