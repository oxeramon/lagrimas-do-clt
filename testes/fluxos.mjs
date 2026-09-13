/* TESTES DE FLUXO · a interface de verdade, num navegador de verdade.
 *
 * Por que este arquivo existe: `regras.mjs` prova o CÁLCULO, e provou certo o
 * tempo todo. Mesmo assim a primeira transferência real ficou bloqueada, por um
 * defeito que só existe quando há DOM: dois `select` com a mesma lista abrem os
 * dois na primeira opção, e o guarda de "contas diferentes" estava preso ao
 * evento `change`, que não dispara ao abrir. Nenhum teste de regra pegaria
 * isso -- o cálculo estava correto, a tela é que não deixava chegar nele.
 *
 * O servidor, o dublê do Supabase e a abertura do app moram em
 * `testes/navegador.mjs`, compartilhados com `testes/rotas.mjs`.
 *
 * Tudo sintético. Nenhum valor, nome ou identificador vem de base nenhuma.
 *
 * COMO RODA: `node testes/fluxos.mjs`. Precisa do Playwright e de um Chromium.
 * Nenhum dos dois é dependência de produção -- o site continua sem build e sem
 * npm. Se não achar o navegador, o arquivo AVISA e sai com 0, em vez de
 * reprovar quem não tem o ambiente montado.
 */
import { exigeNavegador } from "./navegador.mjs";
exigeNavegador("fluxos");
const { abreApp, vaiPara, fechaNavegador } = await import("./navegador.mjs");


/* ------------------------------------------------------------- placar --*/
let ok = 0, bad = 0;
const eq = (nome, got, want) => {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a === b) ok++;
  else { bad++; console.error(`  ✗ ${nome}\n      esperado ${b}\n      obtido   ${a}`); }
};

async function criaConta(p, nome, saldo, primeira){
  await vaiPara(p, "contas");
  await p.waitForTimeout(120);
  await p.click(primeira ? "#btnPrimeiraConta" : "#btnNovaConta");
  await p.waitForTimeout(200);
  await p.fill("#cn_nome", nome);
  await p.fill("#cn_saldo", String(saldo));
  await p.click("#cnSalvar");
  await p.waitForTimeout(350);
}

/* Os números do bloco "previsto e realizado". O espaço do BRL é U+00A0, não
   espaço comum -- comparar sem normalizar falha por um caractere invisível. */
const painel = (p) => p.evaluate(() => {
  const t = (id) => (document.getElementById(id).textContent || "").replace(/\u00a0/g, " ");
  return { entrou:t("pnEntradasReal"), saiu:t("pnSaidasReal"), resultado:t("pnResultado"),
           aReceber:t("pnAReceber"), aPagar:t("pnAPagar"), sobra:t("pnSobra"),
           saldo:t("pnSaldoContas"),
           /* o terceiro estado: marcado como pago SEM lançamento em conta */
           semMovimento: document.getElementById("pnSemMovimento").hidden ? "" : t("pnSemMovimento") };
});

/* ==================================================================
   1. CONTAS: a primeira e a SEGUNDA
   ================================================================== */
for (const largura of [1440, 390]){
  const rotulo = largura === 1440 ? "desktop" : "celular";
  console.log(`\ncontas e transferência · ${rotulo} (${largura}px)`);
  const { p, erros } = await abreApp(largura);

  await criaConta(p, "Conta Alfa", 1000, true);
  eq(`[${rotulo}] a primeira conta aparece na tela`,
    await p.locator(".conta-card").count(), 1);

  await criaConta(p, "Conta Beta", 500, false);
  eq(`[${rotulo}] a SEGUNDA conta aparece na tela`,
    await p.locator(".conta-card").count(), 2);
  eq(`[${rotulo}] as duas contas entraram no banco`,
    await p.evaluate(() => globalThis.__T.contas.map((c) => c.nome)),
    ["Conta Alfa", "Conta Beta"]);

  /* ---- a regressão que motivou este arquivo ---- */
  await vaiPara(p, "transacoes");
  await p.waitForTimeout(150);
  await p.click("#btnTransferir");
  await p.waitForTimeout(250);
  const aoAbrir = await p.evaluate(() => ({
    origem: document.getElementById("tf_origem").value,
    destino: document.getElementById("tf_destino").value,
    desabilitado: document.getElementById("tfSalvar").disabled,
  }));
  eq(`[${rotulo}] ao ABRIR, origem e destino já vêm diferentes`,
    aoAbrir.origem === aoAbrir.destino, false);
  eq(`[${rotulo}] e o botão não nasce travado`, aoAbrir.desabilitado, false);

  /* aceitar os padrões e clicar tem de FUNCIONAR: era exatamente aqui que a
     primeira transferência real morria */
  await p.fill("#tf_valor", "100");
  await p.click("#tfSalvar");
  await p.waitForTimeout(400);
  eq(`[${rotulo}] transferir aceitando os padrões não dá erro`,
    await p.evaluate(() => { const e = document.getElementById("tfErro");
      return e.hidden ? "" : e.textContent; }), "");
  eq(`[${rotulo}] o diálogo fecha sozinho ao dar certo`,
    await p.evaluate(() => document.getElementById("dlgTransferencia").open), false);
  eq(`[${rotulo}] nasceram exatamente duas pernas`,
    await p.evaluate(() => globalThis.__T.transacoes.length), 2);

  /* ---- 1.000 → 900 e 500 → 600, patrimônio parado ---- */
  await vaiPara(p, "contas");
  await p.waitForTimeout(250);
  /* O `Intl` do BRL separa "R$" do número com espaço NÃO separável (U+00A0),
     não com espaço comum. Comparar sem normalizar dá um "esperado X, obtido X"
     que parece defeito do teste e não é de ninguém. */
  eq(`[${rotulo}] a TELA mostra o saldo novo sem recarregar a página`,
    await p.evaluate(() => [...document.querySelectorAll(".conta-card")]
      .map((c) => (c.querySelector(".nome").textContent + "="
                + c.querySelector("[class^=saldo]").textContent).replace(/\u00a0/g, " "))),
    ["Conta Alfa=R$ 900,00", "Conta Beta=R$ 600,00"]);
  eq(`[${rotulo}] patrimônio consolidado não se mexeu`,
    await p.evaluate(() => globalThis.__T.contas.reduce((s, c) => {
      const mov = globalThis.__T.transacoes.filter((t) => t.conta_id === c.id);
      return s + Number(c.saldo_inicial)
        + mov.reduce((x, t) => x + (t.tipo === "entrada" ? +t.valor : -t.valor), 0);
    }, 0)), 1500);

  /* ---- mesma conta dos dois lados continua barrada ---- */
  await vaiPara(p, "transacoes");
  await p.waitForTimeout(150);
  await p.click("#btnTransferir");
  await p.waitForTimeout(220);
  const mesma = await p.evaluate(() => {
    const o = document.getElementById("tf_origem"), d = document.getElementById("tf_destino");
    d.value = o.value; d.dispatchEvent(new Event("change"));
    return { travado: document.getElementById("tfSalvar").disabled,
             avisou: !document.getElementById("tfErro").hidden };
  });
  eq(`[${rotulo}] mesma conta dos dois lados trava o botão`, mesma.travado, true);
  eq(`[${rotulo}] e explica o motivo antes de tentar`, mesma.avisou, true);
  await p.keyboard.press("Escape");
  await p.waitForTimeout(150);

  /* ---- editar e excluir mantêm o par inteiro ---- */
  await p.evaluate(() => document.querySelector(".lanc").click());
  await p.waitForTimeout(250);
  eq(`[${rotulo}] clicar numa perna abre o diálogo de TRANSFERÊNCIA`,
    await p.evaluate(() => document.getElementById("dlgTransferencia").open), true);
  await p.fill("#tf_valor", "250");
  await p.click("#tfSalvar");
  await p.waitForTimeout(400);
  eq(`[${rotulo}] editar mexe nas duas pernas e em nenhuma a mais`,
    await p.evaluate(() => globalThis.__T.transacoes.map((t) => Number(t.valor))), [250, 250]);

  await p.evaluate(() => document.querySelector(".lanc").click());
  await p.waitForTimeout(250);
  await p.click("#tfExcluir");           /* primeiro clique arma */
  await p.waitForTimeout(120);
  await p.click("#tfExcluir");           /* segundo confirma */
  await p.waitForTimeout(400);
  eq(`[${rotulo}] excluir leva as DUAS pernas, nunca uma`,
    await p.evaluate(() => globalThis.__T.transacoes.length), 0);

  eq(`[${rotulo}] nenhum erro de JavaScript no caminho inteiro`, erros, []);
  await p.close();
}

/* ==================================================================
   2. UMA CONTA SÓ: transferência não deve nem ser oferecida
   ================================================================== */
console.log("\numa conta só");
{
  const { p } = await abreApp(1440);
  await criaConta(p, "Conta Única", 100, true);
  await vaiPara(p, "transacoes");
  await p.waitForTimeout(150);
  await p.click("#btnTransferir");
  await p.waitForTimeout(250);
  eq("com uma conta só, o diálogo de transferência não abre",
    await p.evaluate(() => document.getElementById("dlgTransferencia").open), false);
  await p.close();
}

/* ==================================================================
   3. A PONTE: pagar um compromisso e receber uma receita
   ==================================================================
   Aqui mora o risco que a ponte cria. Ligar compromisso e movimento é o que
   deixa o app somar o mesmo dinheiro duas vezes -- e o defeito não aparece
   como erro, aparece como número plausível.

   Os dois casos do contrato anti-dupla-contagem que passam por tela:

     CASO B  dívida/fixa de 200 + o pagamento dela = 200 no mês, nunca 400
     CASO D  receita de 300 + o recebimento dela   = 300 no mês, nunca 600
   ================================================================== */
console.log("\nponte: pagar e receber");
{
  const { p, erros } = await abreApp(1440);
  await criaConta(p, "Conta Alfa", 1000, true);

  /* uma conta fixa de 200, criada pela tela, como qualquer pessoa faria */
  await vaiPara(p, "dividas");
  await p.waitForTimeout(150);
  await p.click("#novaFixa");
  await p.waitForTimeout(250);
  await p.fill("#x_nome", "Aluguel Teste");
  await p.fill("#x_valor", "200");
  await p.click("#formFixa button[type=submit]");
  await p.waitForTimeout(400);

  await vaiPara(p, "mes");
  await p.waitForTimeout(200);

  const antes = await p.evaluate(() => ({
    total: document.getElementById("kTotal").textContent,
    falta: document.getElementById("kFalta").textContent,
    botoes: document.querySelectorAll("#listaMes [data-liquidar]").length,
    rotulo: (document.querySelector("#listaMes [data-liquidar]") || {}).textContent,
  }));
  eq("o compromisso do mês ganha o botão da ponte", antes.botoes, 1);
  eq("e ele diz Pagar enquanto ninguém pagou", antes.rotulo, "Pagar");

  const pAntes = await painel(p);
  eq("o painel começa sem nada realizado", [pAntes.entrou, pAntes.saiu],
    ["R$ 0,00", "R$ 0,00"]);
  eq("com o compromisso inteiro no 'a pagar'", pAntes.aPagar, "R$ 200,00");
  eq("e a sobra projetada é o saldo menos o que falta pagar",
    [pAntes.saldo, pAntes.sobra], ["R$ 1.000,00", "R$ 800,00"]);

  await p.click("#listaMes [data-liquidar]");
  await p.waitForTimeout(300);
  const noDialogo = await p.evaluate(() => ({
    aberto: document.getElementById("dlgLiquidar").open,
    valor: document.getElementById("lq_valor").value,
    conta: document.getElementById("lq_conta").value !== "",
    titulo: document.getElementById("lqTitulo").textContent,
  }));
  eq("o diálogo abre", noDialogo.aberto, true);
  eq("com o valor do compromisso já preenchido", noDialogo.valor, "200.00");
  eq("e com uma conta escolhida, não em branco", noDialogo.conta, true);
  eq("o título fala de pagar", noDialogo.titulo, "Pagar");

  await p.click("#lqSalvar");
  await p.waitForTimeout(500);

  const depois = await p.evaluate(() => ({
    aberto: document.getElementById("dlgLiquidar").open,
    total: document.getElementById("kTotal").textContent,
    falta: document.getElementById("kFalta").textContent,
    rotulo: (document.querySelector("#listaMes [data-liquidar]") || {}).textContent,
    marcado: (document.querySelector("#listaMes .check") || {}).getAttribute?.("aria-pressed"),
    saidas: globalThis.__T.transacoes.filter((t) => t.tipo === "saida").length,
    valor: globalThis.__T.transacoes.map((t) => t.valor),
    marcas: globalThis.__T.pagamentos.length,
    vinculos: globalThis.__T.liquidacoes.length,
  }));
  eq("o diálogo fecha sozinho ao dar certo", depois.aberto, false);
  eq("nasceu UMA saída, e só uma", depois.saidas, 1);
  eq("com o valor do compromisso", depois.valor, [200]);
  eq("a marca da V1 veio junto, na mesma operação", depois.marcas, 1);
  eq("e o vínculo entre os dois", depois.vinculos, 1);
  eq("o quadradinho da V1 aparece marcado", depois.marcado, "true");
  eq("o botão passa a oferecer ver a saída", depois.rotulo, "Ver saída");

  /* ---- CASO B: o total do mês NÃO dobra ---- */
  eq("CASO B · o total do mês continua o mesmo depois de pagar",
    depois.total, antes.total);
  eq("CASO B · e o que falta pagar zerou", depois.falta.replace(/ /g, " "), "R$ 0,00");

  const pDepois = await painel(p);
  eq("o pagamento aparece no realizado", pDepois.saiu, "R$ 200,00");
  eq("e sai do previsto no mesmo movimento", pDepois.aPagar, "R$ 0,00");
  eq("o saldo do painel caiu 200", pDepois.saldo, "R$ 800,00");
  /* A sobra projetada NÃO se mexe: o dinheiro saiu da conta e saiu da lista de
     compromissos ao mesmo tempo. Se ela mudasse, alguém estaria contando duas
     vezes -- é a forma mais curta de enunciar o contrato inteiro. */
  eq("CASO B · a sobra projetada não se mexe ao pagar",
    pDepois.sobra, pAntes.sobra);
  /* Pago pela ponte é LIQUIDADO, e liquidado não é "pago sem movimento". Os
     dois somem do previsto, então só esta linha separa um do outro -- sem ela,
     perder o vínculo passaria despercebido. */
  eq("pago pela ponte não vira 'pago sem lançamento'", pDepois.semMovimento, "");

  /* ---- e o saldo da conta caiu exatamente uma vez ---- */
  await vaiPara(p, "contas");
  await p.waitForTimeout(250);
  eq("o saldo da conta caiu 200, uma vez só",
    (await p.textContent("#ctSaldoTotal")).replace(/ /g, " "), "R$ 800,00");

  /* ---- desfazer apaga as TRÊS coisas ---- */
  await vaiPara(p, "mes");
  await p.waitForTimeout(200);
  await p.click("#listaMes [data-liquidar]");
  await p.waitForTimeout(300);
  eq("no que já foi pago, o diálogo oferece desfazer",
    await p.evaluate(() => !document.getElementById("lqDesfazer").hidden), true);
  eq("e não oferece pagar de novo",
    await p.evaluate(() => document.getElementById("lqSalvar").hidden), true);
  /* dois cliques no mesmo botão, como todo o resto do app */
  await p.click("#lqDesfazer");
  await p.waitForTimeout(120);
  await p.click("#lqDesfazer");
  await p.waitForTimeout(500);

  const desfeito = await p.evaluate(() => ({
    transacoes: globalThis.__T.transacoes.length,
    marcas: globalThis.__T.pagamentos.length,
    vinculos: globalThis.__T.liquidacoes.length,
    rotulo: (document.querySelector("#listaMes [data-liquidar]") || {}).textContent,
  }));
  eq("desfazer apaga a transação", desfeito.transacoes, 0);
  eq("desfazer apaga a marca da V1 junto", desfeito.marcas, 0);
  eq("desfazer apaga o vínculo", desfeito.vinculos, 0);
  eq("e o botão volta a oferecer pagar", desfeito.rotulo, "Pagar");

  /* ================= RECEITA ================= */
  await vaiPara(p, "receitas");
  await p.waitForTimeout(200);
  await p.click("#novaReceita");
  await p.waitForTimeout(250);
  await p.fill("#r_desc", "Extra Teste");
  await p.fill("#r_valor", "300");
  await p.selectOption("#r_tipo", "mensal");
  await p.click("#formReceita button[type=submit]");
  await p.waitForTimeout(400);

  const rAntes = await p.evaluate(() => ({
    total: document.getElementById("rTotal").textContent,
    botoes: document.querySelectorAll("#listaReceitas [data-receber]").length,
    rotulo: (document.querySelector("#listaReceitas [data-receber]") || {}).textContent,
  }));
  eq("a receita do mês ganha o botão de receber", rAntes.botoes, 1);
  eq("e ele diz Receber enquanto não caiu", rAntes.rotulo, "Receber");

  const prAntes = await painel(p);
  eq("a receita entra como 'a receber', não como entrada", 
    [prAntes.aReceber, prAntes.entrou], ["R$ 300,00", "R$ 0,00"]);

  await p.click("#listaReceitas [data-receber]");
  await p.waitForTimeout(300);
  eq("o diálogo abre falando de receber",
    await p.textContent("#lqTitulo"), "Receber");
  eq("e pergunta em qual conta caiu, não de qual saiu",
    await p.textContent("#lqRotConta"), "Em qual conta caiu");

  await p.click("#lqSalvar");
  await p.waitForTimeout(500);

  const rDepois = await p.evaluate(() => ({
    total: document.getElementById("rTotal").textContent,
    rotulo: (document.querySelector("#listaReceitas [data-receber]") || {}).textContent,
    entradas: globalThis.__T.transacoes.filter((t) => t.tipo === "entrada").length,
    marcas: globalThis.__T.pagamentos.length,
    vinculos: globalThis.__T.liquidacoes.length,
  }));
  eq("nasceu UMA entrada", rDepois.entradas, 1);
  eq("receita NÃO vira linha em pagamentos: receita não é pagamento",
    rDepois.marcas, 0);
  eq("o vínculo é o próprio marcador de recebimento", rDepois.vinculos, 1);
  eq("e o botão passa a oferecer ver a entrada", rDepois.rotulo, "Ver entrada");

  /* ---- CASO D: a receita não conta duas vezes ---- */
  eq("CASO D · o previsto do mês continua o mesmo depois de receber",
    rDepois.total, rAntes.total);

  const prDepois = await painel(p);
  eq("recebida, ela vira entrada e sai do 'a receber'",
    [prDepois.entrou, prDepois.aReceber], ["R$ 300,00", "R$ 0,00"]);
  eq("CASO D · a sobra projetada não se mexe ao receber",
    prDepois.sobra, prAntes.sobra);

  await vaiPara(p, "contas");
  await p.waitForTimeout(250);
  eq("o saldo subiu 300, uma vez só",
    (await p.textContent("#ctSaldoTotal")).replace(/ /g, " "), "R$ 1.300,00");

  eq("nenhum erro de JavaScript no caminho inteiro", erros, []);
  await p.close();
}

/* ==================================================================
   4. CARTÃO E FATURA: o CASO A na tela
   ==================================================================
   A prova que dá nome a esta fase, feita clicando:

     compra no cartão      R$ 100
     pagamento da fatura   R$ 100

     consumo = 100    caixa = 100    NUNCA 200 em nenhum dos dois

   O dublê implementa a MESMA regra da 007, inclusive a situação derivada da
   fatura -- se ele guardasse status, deixaria de provar que apagar o
   pagamento reabre a fatura sozinho.
   ================================================================== */
console.log("\ncartão e fatura");
{
  const { p, erros } = await abreApp(1440);
  await criaConta(p, "Conta Alfa", 1000, true);

  await vaiPara(p, "cartoes");
  await p.waitForTimeout(150);
  eq("sem cartão, a tela mostra o vazio e não uma lista em branco",
    await p.evaluate(() => ({ vazio: !document.getElementById("cartoesVazio").hidden,
                              lista: !document.getElementById("cartoesConteudo").hidden })),
    { vazio: true, lista: false });

  await p.click("#btnPrimeiroCartao");
  await p.waitForTimeout(250);
  await p.fill("#cr_nome", "Cartão Teste");
  await p.fill("#cr_fechamento", "10");
  await p.fill("#cr_vencimento", "20");
  /* o ciclo aparece ANTES de salvar: dois números trocados mudam o mês
     inteiro de uma fatura, e ver o resultado é o que impede errar por um dia */
  eq("o diálogo mostra o ciclo resolvido enquanto se digita",
    await p.evaluate(() => !document.getElementById("crCiclo").hidden), true);

  /* DUAS barreiras no campo do final, e elas pegam coisas diferentes.
     A primeira é o `maxlength`: nada além de quatro dígitos entra no campo,
     nem digitado nem colado -- o navegador corta.

     O teste NÃO escreve uma sequência com cara de cartão, nem de mentira: a
     auditoria de repositório público barra isso, e ela está certa. Nove
     dígitos provam a mesma coisa que dezesseis. */
  await p.fill("#cr_final", "123456789");
  eq("o campo do final não aceita mais de quatro dígitos, nem colados",
    await p.inputValue("#cr_final"), "1234");

  /* A segunda é a checagem antes de salvar, para o que passa pelo maxlength
     mas não é dígito. Sem ela, o banco recusaria -- e recusa depois do clique
     é justamente o defeito que a transferência tinha. */
  await p.fill("#cr_final", "12a4");
  await p.click("#crSalvar");
  await p.waitForTimeout(250);
  const recusa = await p.evaluate(() => ({
    aberto: document.getElementById("dlgCartao").open,
    erro: !document.getElementById("crErro").hidden,
  }));
  eq("final que não são quatro dígitos não passa da tela", recusa, { aberto: true, erro: true });
  eq("e nada foi gravado", await p.evaluate(() => globalThis.__T.cartoes.length), 0);

  await p.fill("#cr_final", "1234");
  await p.click("#crSalvar");
  await p.waitForTimeout(400);
  eq("com quatro dígitos, o cartão é criado",
    await p.evaluate(() => globalThis.__T.cartoes.map(c => c.nome + "/" + c.final)),
    ["Cartão Teste/1234"]);
  eq("e a tela troca o vazio pela lista",
    await p.evaluate(() => !document.getElementById("cartoesConteudo").hidden), true);

  /* ---- a compra ---- */
  await p.click("#btnNovaCompra");
  await p.waitForTimeout(250);
  await p.fill("#cp_descricao", "Compra do Caso A");
  await p.fill("#cp_valor", "100");
  await p.fill("#cp_data", "2026-09-05");
  await p.waitForTimeout(150);
  eq("a prévia diz em qual fatura vai cair, antes de gravar",
    await p.evaluate(() => !document.getElementById("cpPrevia").hidden), true);

  await p.click("#cpSalvar");
  await p.waitForTimeout(500);

  const aposCompra = await p.evaluate(() => ({
    compras: globalThis.__T.compras_de_cartao.length,
    parcelas: globalThis.__T.transacoes.length,
    semConta: globalThis.__T.transacoes.every(t => t.conta_id === null),
    faturas: globalThis.__T.faturas.length,
  }));
  eq("a compra virou UMA compra lógica", aposCompra.compras, 1);
  eq("e uma parcela só, porque foi à vista", aposCompra.parcelas, 1);
  eq("a compra no cartão NÃO tem conta: nada saiu de conta nenhuma",
    aposCompra.semConta, true);
  eq("e a fatura do ciclo nasceu sozinha", aposCompra.faturas, 1);

  await vaiPara(p, "contas");
  await p.waitForTimeout(250);
  eq("por isso o saldo da conta não se mexeu",
    (await p.textContent("#ctSaldoTotal")).replace(/ /g, " "), "R$ 1.000,00");

  /* ---- pagar a fatura ---- */
  await vaiPara(p, "cartoes");
  await p.waitForTimeout(200);
  eq("a fatura aparece na lista do cartão",
    await p.locator("#listaCartoes [data-fatura]").count(), 1);
  eq("com as DUAS datas, nunca um mês solto",
    /fecha \d\d\/\d\d · vence \d\d\/\d\d/.test(
      await p.textContent("#listaCartoes .fatura-quando")), true);

  await p.click("#listaCartoes [data-fatura]");
  await p.waitForTimeout(400);
  const noDlg = await p.evaluate(() => ({
    aberto: document.getElementById("dlgFatura").open,
    valor: document.getElementById("ft_valor").value,
    avisa: !document.getElementById("ftAviso").hidden,
    itens: document.querySelectorAll("#ftItens .row").length,
    total: document.getElementById("ftTotal").textContent.replace(/ /g, " "),
    falta: document.getElementById("ftRestante").textContent.replace(/ /g, " "),
  }));
  eq("o diálogo da fatura abre", noDlg.aberto, true);
  eq("com o que FALTA já preenchido", noDlg.valor, "100.00");
  eq("e diz o que sabe e o que não sabe ANTES do clique", noDlg.avisa, true);
  eq("os lançamentos da fatura aparecem", noDlg.itens, 1);
  eq("o bloco mostra total e o que falta", [noDlg.total, noDlg.falta],
    ["R$ 100,00", "R$ 100,00"]);

  /* ---- PAGAMENTO PARCIAL: 40 de 100 (contrato da 012) ----
     A fatura NÃO pode virar "paga" com o primeiro pedaço, e o que falta tem de
     ser 60. Isto era impossível antes: a unique da 005 recusava o segundo
     pagamento, então o produto só sabia pagar tudo. */
  await p.fill("#ft_valor", "40");
  await p.click("#ftPagarBtn");
  await p.waitForTimeout(500);
  await p.click("#listaCartoes [data-fatura]");
  await p.waitForTimeout(400);
  const parcial = await p.evaluate(() => ({
    pago: document.getElementById("ftPago").textContent.replace(/ /g, " "),
    falta: document.getElementById("ftRestante").textContent.replace(/ /g, " "),
    sugerido: document.getElementById("ft_valor").value,
    aindaPaga: !document.getElementById("ftPagarBtn").hidden,
    pagamentos: document.querySelectorAll("#ftPagamentos [data-desfaz]").length,
    situacao: document.querySelector("#listaCartoes .pill").textContent,
  }));
  eq("pagamento parcial: pago 40", parcial.pago, "R$ 40,00");
  eq("pagamento parcial: falta 60", parcial.falta, "R$ 60,00");
  /* o padrão é o que falta, não o total: propor 100 seria propor um valor que
     o banco recusa */
  eq("e o campo já vem com o que falta, não com o total", parcial.sugerido, "60.00");
  eq("a fatura NÃO virou paga com o primeiro pedaço", parcial.aindaPaga, true);
  eq("o pagamento feito aparece com o próprio desfazer", parcial.pagamentos, 1);
  eq("e a situação na lista é Parcial", parcial.situacao, "Parcial");

  /* o excesso é BARRADO, e a recusa chega como mensagem, não como silêncio */
  await p.fill("#ft_valor", "500");
  await p.click("#ftPagarBtn");
  await p.waitForTimeout(400);
  eq("pagar acima do que falta é recusado, com motivo na tela",
    await p.evaluate(() => { const e = document.getElementById("ftErro");
      return e.hidden ? "" : e.textContent.length > 0; }), true);
  eq("e nada foi lançado por causa da tentativa recusada",
    await p.evaluate(() => globalThis.__T.liquidacoes.filter(l => l.tipo === "fatura").length), 1);

  /* fecha os 60 que faltavam */
  await p.fill("#ft_valor", "60");
  await p.click("#ftPagarBtn");
  await p.waitForTimeout(500);

  const aposPagar = await p.evaluate(() => {
    const T = globalThis.__T;
    const conta = (t) => ["realizada","conciliada"].includes(t.status);
    return {
      consumo: T.transacoes.filter(t => t.tipo === "saida" && t.natureza === "normal" && conta(t))
                 .reduce((s,t) => s + t.valor, 0),
      caixa: T.transacoes.filter(t => t.tipo === "saida" && t.conta_id && conta(t))
                 .reduce((s,t) => s + t.valor, 0),
      pagamentoSemFatura: T.transacoes.filter(t => t.natureza === "pagamento_de_fatura")
                 .every(t => t.fatura_id === null),
      vinculos: T.liquidacoes.filter(l => l.tipo === "fatura").length,
      situacao: document.querySelector("#listaCartoes .pill").textContent,
    };
  });
  eq("CASO A · o consumo é 100, e é a compra quem entra", aposPagar.consumo, 100);
  eq("CASO A · o caixa é 100, e é o pagamento quem entra", aposPagar.caixa, 100);
  eq("CASO A · somados dariam 200, e nenhum indicador da tela faz isso",
    aposPagar.consumo + aposPagar.caixa, 200);
  eq("o pagamento NÃO é item da fatura", aposPagar.pagamentoSemFatura, true);
  /* DOIS vínculos: 40 + 60. O consumo continua 100 e o caixa continua 100,
     que é o ponto -- fatiar o pagamento não muda nenhum dos dois lados. */
  eq("os vínculos registram os dois pedaços do pagamento", aposPagar.vinculos, 2);
  eq("e a fatura passa a dizer Paga", aposPagar.situacao, "Paga");

  await vaiPara(p, "contas");
  await p.waitForTimeout(250);
  eq("agora sim o saldo caiu, uma vez só",
    (await p.textContent("#ctSaldoTotal")).replace(/ /g, " "), "R$ 900,00");

  /* ---- desfazer ---- */
  await vaiPara(p, "cartoes");
  await p.waitForTimeout(200);
  await p.click("#listaCartoes [data-fatura]");
  await p.waitForTimeout(400);
  /* O botão único de desfazer saiu com a 012: uma fatura recebe N pagamentos e
     não há UM id que a represente. Cada pagamento traz o próprio botão. */
  eq("na fatura paga, o diálogo oferece desfazer por pagamento e não pagar de novo",
    await p.evaluate(() => ({
      desfazer: document.querySelectorAll("#ftPagamentos [data-desfaz]").length,
      pagar: document.getElementById("ftPagarBtn").hidden })),
    { desfazer: 2, pagar: true });

  /* Desfaz o PRIMEIRO e confere que o outro sobreviveu. É a regressão contra
     `desfaz_liquidacao`, que apagaria a competência inteira: com ela no lugar,
     este número seria zero. */
  await p.click("#ftPagamentos [data-desfaz]");
  await p.waitForTimeout(120);
  await p.click("#ftPagamentos [data-desfaz]");
  await p.waitForTimeout(500);
  eq("desfazer UM pagamento não apaga o outro",
    await p.evaluate(() => globalThis.__T.liquidacoes.filter(l => l.tipo === "fatura").length), 1);
  eq("e a fatura volta a ser Parcial, não 'A pagar'",
    await p.textContent("#listaCartoes .pill"), "Parcial");

  /* agora desfaz o que sobrou, para o resto do arquivo continuar no mesmo
     cenário de antes */
  await p.click("#listaCartoes [data-fatura]");
  await p.waitForTimeout(400);
  await p.click("#ftPagamentos [data-desfaz]");
  await p.waitForTimeout(120);
  await p.click("#ftPagamentos [data-desfaz]");
  await p.waitForTimeout(500);

  eq("desfazer apaga o pagamento e o vínculo junto",
    await p.evaluate(() => ({
      pagamentos: globalThis.__T.transacoes.filter(t => t.natureza === "pagamento_de_fatura").length,
      vinculos: globalThis.__T.liquidacoes.length })),
    { pagamentos: 0, vinculos: 0 });
  /* a situação é DERIVADA: ninguém precisou reabrir a fatura à mão */
  eq("e a fatura volta sozinha para 'a pagar'",
    await p.textContent("#listaCartoes .pill"), "A pagar");

  await vaiPara(p, "contas");
  await p.waitForTimeout(250);
  eq("o saldo volta ao que era",
    (await p.textContent("#ctSaldoTotal")).replace(/ /g, " "), "R$ 1.000,00");

  /* ---- os blocos de Obrigações, Rotinas e Compartilhado ----
     Cada um some quando não tem o que dizer: bloco zerado ocupa espaço e não
     informa nada. E eles NÃO se somam entre si -- fatura aberta é obrigação,
     assinatura é rotina, e o que o grupo te deve não é dinheiro seu ainda. */
  await vaiPara(p, "painel");
  await p.waitForTimeout(200);
  eq("com um cartão com fatura, o bloco de obrigações aparece",
    await p.evaluate(() => !document.getElementById("blocoObrigacoes").hidden), true);
  eq("o bloco de rotinas some quando não há assinatura",
    await p.evaluate(() => document.getElementById("blocoRotinas").hidden), true);
  eq("e o de compartilhado também, sem grupo nenhum",
    await p.evaluate(() => document.getElementById("blocoCompartilhado").hidden), true);
  eq("as faturas a pagar aparecem separadas das dívidas da V1",
    await p.evaluate(() => ({
      faturas: document.getElementById("pbFaturas").textContent.replace(/ /g, " "),
      dividas: document.getElementById("pbDividas").textContent.replace(/ /g, " "),
    })),
    { faturas: "R$ 100,00", dividas: "R$ 0,00" });

  /* ---- parcelamento ---- */
  await vaiPara(p, "cartoes");
  await p.waitForTimeout(150);
  await p.click("#btnNovaCompra");
  await p.waitForTimeout(250);
  await p.fill("#cp_descricao", "Compra Parcelada");
  await p.fill("#cp_valor", "100");
  await p.fill("#cp_data", "2026-09-05");
  await p.fill("#cp_parcelas", "3");
  await p.waitForTimeout(150);
  await p.click("#cpSalvar");
  await p.waitForTimeout(500);

  const parcelado = await p.evaluate(() => {
    /* filtrar por `parcela` pegaria também a compra à vista, que é a parcela
       1 de 1. O recorte é pela COMPRA, que tem identidade própria -- é para
       isso que `compra_id` existe. */
    const compra = globalThis.__T.compras_de_cartao.find(c => c.total_parcelas === 3);
    const t = globalThis.__T.transacoes.filter(x => x.compra_id === compra.id);
    return { quantas: t.length,
             soma: Math.round(t.reduce((s,x) => s + x.valor, 0) * 100) / 100,
             primeira: t.find(x => x.parcela === 1).valor,
             ultima: t.find(x => x.parcela === 3).valor,
             faturas: new Set(t.map(x => x.fatura_id)).size };
  });
  eq("três parcelas nascem juntas", parcelado.quantas, 3);
  eq("e somam exatamente o total", parcelado.soma, 100);
  eq("com a sobra de centavos na primeira",
    [parcelado.primeira, parcelado.ultima], [33.34, 33.33]);
  eq("cada parcela numa fatura diferente", parcelado.faturas, 3);

  eq("nenhum erro de JavaScript no caminho inteiro", erros, []);
  await p.close();
}

/* ==================================================================
   5. ASSINATURAS: a regra, e a ocorrência que ela gera
   ==================================================================
   A propriedade que este bloco existe para provar: gerar duas vezes não
   duplica nada. Sem ela, chamar a materialização a cada carga da tela -- que
   é exatamente o que o app faz -- encheria o banco de cobranças repetidas.
   ================================================================== */
console.log("\nassinaturas");
{
  const { p, erros } = await abreApp(1440);
  await criaConta(p, "Conta Alfa", 1000, true);

  await vaiPara(p, "assinaturas");
  await p.waitForTimeout(150);
  eq("sem assinatura, a tela mostra o vazio",
    await p.evaluate(() => !document.getElementById("assinaturasVazio").hidden), true);

  await p.click("#btnPrimeiraAssinatura");
  await p.waitForTimeout(250);
  await p.fill("#as_nome", "Assinatura Mensal");
  await p.fill("#as_valor", "30");
  await p.fill("#as_inicio", "2026-09-20");
  await p.click("#asSalvar");
  await p.waitForTimeout(500);

  eq("a assinatura foi criada",
    await p.evaluate(() => globalThis.__T.assinaturas.map(a => a.nome)), ["Assinatura Mensal"]);
  eq("e a tela troca o vazio pela lista",
    await p.evaluate(() => !document.getElementById("assinaturasConteudo").hidden), true);
  eq("o custo mensal aparece no topo",
    (await p.textContent("#asMensal")).replace(/ /g, " "), "R$ 30,00");
  eq("e o anual equivalente também",
    (await p.textContent("#asAnual")).replace(/ /g, " "), "R$ 360,00");

  /* a materialização já rodou na carga; as ocorrências são PREVISTAS */
  const ocorrencias = await p.evaluate(() => {
    const t = globalThis.__T.transacoes.filter(x => x.assinatura_id);
    return { quantas: t.length, todasPrevistas: t.every(x => x.status === "prevista"),
             comCompetencia: t.every(x => !!x.competencia) };
  });
  eq("a assinatura virou ocorrências previstas", ocorrencias.quantas > 0, true);
  eq("todas nascem previstas: elas ainda não aconteceram", ocorrencias.todasPrevistas, true);
  eq("e cada uma sabe de qual período é", ocorrencias.comCompetencia, true);

  /* PREVISTO NÃO É DINHEIRO */
  await vaiPara(p, "contas");
  await p.waitForTimeout(250);
  eq("ocorrência prevista não mexe no saldo da conta",
    (await p.textContent("#ctSaldoTotal")).replace(/ /g, " "), "R$ 1.000,00");

  /* A IDEMPOTÊNCIA, medida recarregando a tela inteira */
  const antes = await p.evaluate(() => globalThis.__T.transacoes.length);
  await vaiPara(p, "assinaturas");
  await p.waitForTimeout(150);
  await vaiPara(p, "contas");
  await p.waitForTimeout(150);
  await p.click("#btnNovaConta");
  await p.waitForTimeout(200);
  await p.fill("#cn_nome", "Conta Beta");
  await p.fill("#cn_saldo", "0");
  await p.click("#cnSalvar");
  await p.waitForTimeout(500);
  eq("recarregar não cria ocorrência nenhuma a mais: a idempotência é do banco",
    await p.evaluate(() => globalThis.__T.transacoes.length), antes);

  /* ANUAL: o equivalente é o que dá sentido à comparação */
  await vaiPara(p, "assinaturas");
  await p.waitForTimeout(150);
  await p.click("#btnNovaAssinatura");
  await p.waitForTimeout(250);
  await p.fill("#as_nome", "Assinatura Anual");
  await p.fill("#as_valor", "120");
  await p.selectOption("#as_frequencia", "anual");
  await p.fill("#as_inicio", "2026-10-01");
  await p.waitForTimeout(150);
  eq("o diálogo mostra o equivalente mensal antes de salvar",
    (await p.textContent("#asEquivalente")).includes("10,00"), true);
  await p.click("#asSalvar");
  await p.waitForTimeout(500);

  eq("o custo mensal soma os equivalentes, não os valores crus",
    (await p.textContent("#asMensal")).replace(/ /g, " "), "R$ 40,00");
  /* 120 por ano é MENOR que 30 por mês, e a tela precisa concordar com isso */
  eq("a maior é pela régua mensal", await p.textContent("#asMaior"), "Assinatura Mensal");

  /* SEMANAL: cadastra, avisa, e não gera */
  await p.click("#btnNovaAssinatura");
  await p.waitForTimeout(250);
  await p.fill("#as_nome", "Assinatura Semanal");
  await p.fill("#as_valor", "9");
  await p.selectOption("#as_frequencia", "semanal");
  await p.fill("#as_inicio", "2026-09-15");
  await p.waitForTimeout(150);
  eq("o diálogo avisa que a semanal ainda não vira lançamento",
    (await p.textContent("#asEquivalente")).includes("ainda não vira lançamento"), true);
  await p.click("#asSalvar");
  await p.waitForTimeout(500);
  eq("ela é cadastrada",
    await p.evaluate(() => globalThis.__T.assinaturas.length), 3);
  eq("mas não gera ocorrência nenhuma",
    await p.evaluate(() => globalThis.__T.transacoes.filter(t =>
      t.assinatura_id === globalThis.__T.assinaturas.find(a => a.frequencia === "semanal").id).length),
    0);
  eq("e a lista diz isso, em vez de deixar esperando",
    (await p.textContent("#listaAssinaturas")).includes("ainda não vira lançamento"), true);

  /* Antes de pausar, as três somam 79 por mês equivalente: 30 da mensal, 10 da
     anual e 39 da semanal. A semanal ENTRA no custo mesmo sem virar
     lançamento -- ela é cobrada de qualquer jeito, e deixá-la fora do total
     seria mentir sobre quanto a pessoa gasta. */
  eq("a semanal entra no custo mesmo sem virar lançamento",
    (await p.textContent("#asMensal")).replace(/\u00a0/g, " "), "R$ 79,00");

  /* PAUSAR tira do custo sem apagar o histórico. A primeira da lista é a
     mensal, de 30: 79 menos 30 dá 49. */
  await p.click("#listaAssinaturas [data-editassinatura]");
  await p.waitForTimeout(250);
  await p.selectOption("#as_ativo", "nao");
  await p.click("#asSalvar");
  await p.waitForTimeout(500);
  eq("assinatura pausada sai do custo mensal",
    (await p.textContent("#asMensal")).replace(/ /g, " "), "R$ 49,00");
  eq("mas continua na lista, marcada",
    (await p.textContent("#listaAssinaturas")).includes("pausada"), true);

  eq("nenhum erro de JavaScript no caminho inteiro", erros, []);
  await p.close();
}

/* ==================================================================
   6. NAVEGAÇÃO: o registro é a única verdade
   ==================================================================
   A lateral e o rodapé do celular eram escritos à mão, e discordavam do
   registro -- Assinaturas apareceu em PLANEJAMENTO e Grupos no rodapé da
   lateral, porque acrescentar uma tela virava duas edições e a segunda era a
   esquecida. Agora os dois são montados a partir de js/ui/navigation.js.

   Estes casos existem para que a próxima divergência não passe.
   ================================================================== */
console.log("\nnavegação");
{
  const { p, erros } = await abreApp(1440);

  eq("a lateral tem os grupos na ordem do registro",
    await p.evaluate(() => [...document.querySelectorAll(".lateral .grupo-nav")]
      .map(e => e.textContent)),
    ["VISÃO", "MEU DINHEIRO", "PLANEJAMENTO", "ROTINAS"]);

  eq("e cada aba está no grupo certo",
    await p.evaluate(() => {
      const fora = [];
      let atual = null;
      for (const el of document.querySelectorAll(".lateral nav > *")){
        if (el.classList.contains("grupo-nav")) atual = el.textContent;
        else fora.push(atual + "/" + el.querySelector("span").textContent);
      }
      return fora;
    }),
    ["VISÃO/Início", "VISÃO/Mês",
     "MEU DINHEIRO/Contas", "MEU DINHEIRO/Cartões", "MEU DINHEIRO/Transações",
     "MEU DINHEIRO/Receitas",
     "PLANEJAMENTO/Dívidas", "PLANEJAMENTO/Projeção",
     "ROTINAS/Assinaturas", "ROTINAS/Grupos"]);

  /* Ajustes não fica na lista: ele mora no rodapé da lateral, junto de
     Atualizar e do tema, e é lá que se procura por ele. */
  eq("Ajustes fica no rodapé da lateral, e não no meio das seções",
    await p.evaluate(() => !!document.querySelector(".lateral .rodape #nav-ajustes")), true);

  /* Oito ícones espremidos em 360px não é navegação, é enigma. */
  eq("o rodapé do celular tem no máximo cinco itens fixos",
    await p.evaluate(() => document.querySelectorAll("nav.rodapenav .navitem").length), 5);
  eq("e o quinto é o Mais",
    await p.evaluate(() => document.querySelector("nav.rodapenav .navitem:last-child").id),
    "navm-mais");

  /* Destino morto é pior que menu curto: uma entrada que abre o nada. */
  eq("toda aba da lateral tem painel correspondente",
    await p.evaluate(() => [...document.querySelectorAll(".lateral .navitem[aria-controls]")]
      .filter(b => !document.getElementById(b.getAttribute("aria-controls"))).length), 0);
  eq("e toda aba do rodapé também",
    await p.evaluate(() => [...document.querySelectorAll("nav.rodapenav .navitem[aria-controls]")]
      .filter(b => !document.getElementById(b.getAttribute("aria-controls"))).length), 0);

  /* clicar em cada uma abre a tela dela, e só ela */
  for (const aba of ["painel","mes","contas","cartoes","transacoes","receitas",
                     "dividas","proj","assinaturas","grupos","ajustes"]){
    await vaiPara(p, aba);
    await p.waitForTimeout(80);
    eq("a aba " + aba + " abre o painel dela, e só ele",
      await p.evaluate((a) => {
        const abertos = [...document.querySelectorAll("section.panel")]
          .filter(s => !s.hidden).map(s => s.id);
        return abertos.join(",") === "p-" + a;
      }, aba), true);
  }

  eq("nenhum erro de JavaScript na navegação inteira", erros, []);
  await p.close();
}

/* ==================================================================
   7. ROLAGEM LATERAL: mobile é primeira classe
   ================================================================== */
console.log("\nrolagem lateral");
{
  const { p } = await abreApp(1440);
  await criaConta(p, "Conta Alfa", 1000, true);
  await criaConta(p, "Conta Beta", 500, false);

  /* A linha do Mês e o cartão de Receitas ganharam um botão cada. `1fr` de
     grid cresce até o filho mais largo, e a linha do Mês é flex com quatro
     filhos: o defeito não aparece no monitor, só em 320px. Por isso as duas
     telas entram aqui COM conteúdo -- tela vazia não mede nada. */
  await vaiPara(p, "dividas");
  await p.waitForTimeout(150);
  await p.click("#novaFixa");
  await p.waitForTimeout(250);
  await p.fill("#x_nome", "Conta Fixa de Nome Razoavelmente Longo");
  await p.fill("#x_valor", "1234.56");
  await p.click("#formFixa button[type=submit]");
  await p.waitForTimeout(400);

  await vaiPara(p, "receitas");
  await p.waitForTimeout(150);
  await p.click("#novaReceita");
  await p.waitForTimeout(250);
  await p.fill("#r_desc", "Receita de Nome Razoavelmente Longo");
  await p.fill("#r_valor", "9876.54");
  await p.selectOption("#r_tipo", "mensal");
  await p.click("#formReceita button[type=submit]");
  await p.waitForTimeout(400);

  for (const largura of [320, 360, 390, 768, 1366, 1440]){
    await p.setViewportSize({ width: largura, height: 900 });
    for (const aba of ["painel", "mes", "contas", "cartoes", "assinaturas",
                       "grupos", "transacoes", "receitas"]){
      await vaiPara(p, aba);
      await p.waitForTimeout(120);
      eq(`sem rolagem lateral em ${largura}px na aba ${aba}`,
        await p.evaluate(() =>
          document.documentElement.scrollWidth - document.documentElement.clientWidth), 0);
    }
  }
  await p.close();
}

await fechaNavegador();
console.log(`\n${ok} passaram, ${bad} falharam`);
process.exit(bad ? 1 : 0);
