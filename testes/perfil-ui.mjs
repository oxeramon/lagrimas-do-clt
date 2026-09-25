/* Exercita o perfil no navegador com usuário sintético e sem rede. */
import { exigeNavegador } from "./navegador.mjs";
exigeNavegador("perfil-ui");
const { abreApp, fechaNavegador } = await import("./navegador.mjs");

let falhas = 0;
function confere(rotulo, condicao){
  if (condicao) console.log("  ✓ " + rotulo);
  else { console.error("  ✗ " + rotulo); falhas++; }
}

for (const largura of [1440, 390]){
  const { p, erros } = await abreApp(largura);
  if (largura < 600){
    await p.locator("#navm-mais").click();
    await p.locator("#navs-perfil").click();
    await p.waitForFunction(() => !document.getElementById("folhaMais").open);
  } else await p.locator("#nav-perfil").click();
  await p.waitForFunction(() => document.getElementById("perfilEmail").value.length > 0);
  confere(`${largura}px: perfil abriu`, await p.locator("#p-perfil").isVisible());
  confere(`${largura}px: e-mail exibido`, await p.locator("#perfilEmail").inputValue() === "teste@example.com");
  await p.locator("#perfilNome").fill("Pessoa Exemplo");
  await p.locator("#perfilTelefone").fill("(11) 99999-0000");
  await p.locator("#perfilSalvarDados").click();
  await p.getByText("Dados salvos.").waitFor();
  confere(`${largura}px: nome editado`, await p.locator("#perfilNomeExibido").textContent() === "Pessoa Exemplo");
  await p.locator("#perfilEmail").fill("novo@example.com");
  await p.locator("#perfilSalvarEmail").click();
  await p.getByText(/Confira sua caixa de entrada/).waitFor();
  confere(`${largura}px: alteração de e-mail pede confirmação`, await p.locator("#perfilEmailMensagem").isVisible());
  const png = await p.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 2;
    canvas.getContext("2d").fillRect(0, 0, 2, 2);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  await p.locator("#perfilArquivo").setInputFiles({
    name: "foto.png", mimeType: "image/png", buffer: Buffer.from(png, "base64"),
  });
  await p.getByText("Foto atualizada.").waitFor();
  confere(`${largura}px: foto exibida`, await p.locator("#perfilImagem").isVisible());
  await p.locator("#perfilRemoverFoto").click();
  await p.getByText("Foto removida.").waitFor();
  confere(`${largura}px: foto removida`, await p.locator("#perfilImagem").isHidden());
  confere(`${largura}px: sem erro de página`, erros.length === 0);
  await p.close();
}
await fechaNavegador();
process.exit(falhas ? 1 : 0);

