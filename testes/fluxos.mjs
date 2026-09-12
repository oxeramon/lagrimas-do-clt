/* TESTES DE FLUXO · a interface de verdade, num navegador de verdade.
 *
 * Por que este arquivo existe: `regras.mjs` prova o CÁLCULO, e provou certo o
 * tempo todo. Mesmo assim a primeira transferência real ficou bloqueada, por um
 * defeito que só existe quando há DOM: dois `select` com a mesma lista abrem os
 * dois na primeira opção, e o guarda de "contas diferentes" estava preso ao
 * evento `change`, que não dispara ao abrir. Nenhum teste de regra pegaria
 * isso -- o cálculo estava correto, a tela é que não deixava chegar nele.
 *
 * O dublê do Supabase aqui é mais fiel que o da prévia: ele guarda estado,
 * aplica insert e update, recalcula `saldos_de_conta` como a view faria, e
 * implementa as RPCs com a MESMA regra da 004. Assim, quando este arquivo e
 * `supabase/testes/004_operacoes.sql` concordam, a concordância significa
 * alguma coisa.
 *
 * Tudo sintético. Nenhum valor, nome ou identificador vem de base nenhuma.
 *
 * COMO RODA: `node testes/fluxos.mjs`. Precisa do Playwright e de um Chromium.
 * Nenhum dos dois é dependência de produção -- o site continua sem build e sem
 * npm. Se não achar o navegador, o arquivo AVISA e sai com 0, em vez de
 * reprovar quem não tem o ambiente montado.
 */
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const CHROMIUM = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

/* O Playwright costuma estar instalado GLOBALMENTE, e import por nome só
   procura em `node_modules` acima do arquivo -- por isso a busca inclui os
   caminhos globais do npm. Sem isto o teste se declarava "pulado" num ambiente
   onde o navegador existia, que é a pior das respostas: verde sem ter rodado. */
async function achaPlaywright(){
  const tentativas = ["playwright"];
  try {
    const { execFileSync } = await import("node:child_process");
    const raiz = execFileSync("npm", ["root", "-g"], { encoding:"utf8" }).trim();
    if (raiz) tentativas.push(join(raiz, "playwright", "index.mjs"),
                              "file://" + join(raiz, "playwright", "index.mjs"));
  } catch { /* sem npm no PATH: resta a tentativa por nome */ }
  for (const alvo of tentativas){
    try { const m = await import(alvo); if (m.chromium) return m.chromium; } catch { /* segue */ }
  }
  return null;
}
const chromium = await achaPlaywright();
if (!chromium){
  console.log("fluxos: Playwright não encontrado — pulando (não é dependência de produção).");
  process.exit(0);
}
if (!existsSync(CHROMIUM)){
  console.log("fluxos: Chromium não encontrado em " + CHROMIUM + " — pulando.");
  console.log("        defina CHROMIUM_PATH para apontar para um navegador.");
  process.exit(0);
}

/* ------------------------------------------------------------- servidor --
   O navegador RECUSA `import` a partir de file://. Servir por HTTP é o mesmo
   que o GitHub Pages faz, então o que passa aqui passa lá. */
const TIPO = { ".html":"text/html", ".js":"text/javascript", ".css":"text/css",
               ".json":"application/json", ".svg":"image/svg+xml" };
const servidor = createServer((req, res) => {
  const alvoBruto = join(RAIZ, decodeURIComponent(req.url.split("?")[0]));
  const alvo = existsSync(alvoBruto) && statSync(alvoBruto).isDirectory()
    ? join(alvoBruto, "index.html") : alvoBruto;
  if (!existsSync(alvo) || !alvo.startsWith(RAIZ)){ res.writeHead(404); return res.end("404"); }
  res.writeHead(200, { "content-type": TIPO[extname(alvo)] || "application/octet-stream" });
  res.end(readFileSync(alvo));
});
const PORTA = 8093;
await new Promise((ok) => servidor.listen(PORTA, "127.0.0.1", ok));

/* --------------------------------------------------------------- dublê --*/
const DUBLE = `
const T = { instituicoes:[], contas:[], categorias:[], transacoes:[], liquidacoes:[],
            dividas:[], fixas:[], credores:[], receitas:[], pagamentos:[], fixas_mes:[], config:[] };
let seq = 0;
const uid = () => "id-" + (++seq);
globalThis.__T = T;

/* a view saldos_de_conta, recalculada como o Postgres faria:
   saldo_inicial + entradas realizadas − saídas realizadas */
function saldos(){
  return T.contas.map(c => {
    const mov = T.transacoes.filter(t => t.conta_id === c.id
      && ["realizada","conciliada"].includes(t.status) && t.data >= c.saldo_inicial_em);
    const soma = mov.reduce((s,t) => s + (t.tipo === "entrada" ? +t.valor : -t.valor), 0);
    return { conta_id:c.id, user_id:"u1", nome:c.nome, tipo:c.tipo, liquidez:c.liquidez,
             saldo_inicial:c.saldo_inicial, saldo_inicial_em:c.saldo_inicial_em,
             saldo: Number(c.saldo_inicial) + soma };
  });
}
const linhasDe = (t) => t === "saldos_de_conta" ? saldos() : (T[t] || []);

export function createClient(){
  const consulta = (tabela) => {
    const filtros = [];
    const api = {
      select:()=>api, order:()=>api, limit:()=>api,
      gte:(k,v)=>{filtros.push(r=>r[k]>=v); return api;},
      lt:(k,v)=>{filtros.push(r=>r[k]<v); return api;},
      lte:(k,v)=>{filtros.push(r=>r[k]<=v); return api;},
      eq:(k,v)=>{filtros.push(r=>r[k]===v); return api;},
      in:(k,v)=>{filtros.push(r=>v.includes(r[k])); return api;},
      insert:(x)=>{
        const arr = (Array.isArray(x)?x:[x]).map(r=>({ ...r, id:r.id||uid(), user_id:"u1" }));
        T[tabela] = (T[tabela]||[]).concat(arr);
        const pr = Promise.resolve({ data:arr, error:null });
        return { select:()=>({ then:(a,b)=>pr.then(a,b) }), single:()=>pr, then:(a,b)=>pr.then(a,b) };
      },
      update:(x)=>({ eq:(k,v)=>{ (T[tabela]||[]).forEach(r=>{ if(r[k]===v) Object.assign(r,x); });
        return Promise.resolve({ data:null, error:null }); } }),
      upsert:()=>Promise.resolve({ data:null, error:null }),
      delete:()=>({ eq:(k,v)=>{ T[tabela]=(T[tabela]||[]).filter(r=>r[k]!==v);
        return Promise.resolve({ data:null, error:null }); },
        in:()=>Promise.resolve({ data:null, error:null }) }),
      maybeSingle:()=>Promise.resolve({ data:linhasDe(tabela)[0]||null, error:null }),
      single:()=>Promise.resolve({ data:linhasDe(tabela)[0]||null, error:null }),
      then:(a,b)=>{ const l = linhasDe(tabela).filter(r => filtros.every(f=>f(r)));
        return Promise.resolve({ data:l, error:null, count:l.length }).then(a,b); },
    };
    return api;
  };
  return {
    from: consulta,
    /* a MESMA regra da 004: se as duas implementações divergirem, um dos dois
       lados está errado e o teste que passar estará mentindo */
    rpc: (nome, a) => {
      if (nome === "cria_transferencia"){
        if (!a.p_conta_origem || !a.p_conta_destino)
          return Promise.resolve({ data:null, error:{ message:"transferência: escolha a conta de origem e a de destino" } });
        if (a.p_conta_origem === a.p_conta_destino)
          return Promise.resolve({ data:null, error:{ message:"transferência: a conta de origem e a de destino precisam ser diferentes" } });
        if (!(a.p_valor > 0))
          return Promise.resolve({ data:null, error:{ message:"transferência: o valor precisa ser maior que zero" } });
        const g = uid();
        T.transacoes.push(
          { id:uid(), user_id:"u1", conta_id:a.p_conta_origem, tipo:"saida", natureza:"transferencia",
            transferencia_id:g, descricao:a.p_descricao, valor:a.p_valor, data:a.p_data,
            status:a.p_status, origem:"manual", obs:a.p_obs },
          { id:uid(), user_id:"u1", conta_id:a.p_conta_destino, tipo:"entrada", natureza:"transferencia",
            transferencia_id:g, descricao:a.p_descricao, valor:a.p_valor, data:a.p_data,
            status:a.p_status, origem:"manual", obs:a.p_obs });
        return Promise.resolve({ data:g, error:null });
      }
      if (nome === "remove_transferencia"){
        const antes = T.transacoes.length;
        T.transacoes = T.transacoes.filter(t => t.transferencia_id !== a.p_transferencia);
        const n = antes - T.transacoes.length;
        return Promise.resolve(n ? { data:n, error:null }
          : { data:null, error:{ message:"transferência: não encontrei nada para excluir" } });
      }
      if (nome === "atualiza_transferencia"){
        const pernas = T.transacoes.filter(t => t.transferencia_id === a.p_transferencia);
        if (pernas.length !== 2)
          return Promise.resolve({ data:null, error:{ message:"transferência: não encontrei as duas pernas para atualizar" } });
        if (a.p_conta_origem === a.p_conta_destino)
          return Promise.resolve({ data:null, error:{ message:"transferência: a conta de origem e a de destino precisam ser diferentes" } });
        pernas.forEach(t => Object.assign(t, { valor:a.p_valor, data:a.p_data,
          descricao:a.p_descricao, obs:a.p_obs, status:a.p_status,
          conta_id: t.tipo === "saida" ? a.p_conta_origem : a.p_conta_destino }));
        return Promise.resolve({ data:a.p_transferencia, error:null });
      }
      /* --- a ponte com a V1, mesma regra da 005 --- */
      const confere = (tipo, itemId, competencia, conta, valor) => {
        if (!conta) return "liquidação: escolha a conta";
        if (!(valor > 0)) return "liquidação: o valor precisa ser maior que zero";
        if (!/^[0-9]{4}-(0[1-9]|1[0-2])$/.test(competencia||""))
          return "liquidação: a competência precisa estar no formato AAAA-MM";
        if (!T.contas.some(c => c.id === conta)) return "liquidação: conta não encontrada";
        const achou = tipo === "divida"  ? T.dividas.some(d => d.id === itemId)
                    : tipo === "fixa"    ? (itemId.slice(0,3) === "fx:"
                                            && T.fixas.some(f => f.id === itemId.slice(3)))
                    : tipo === "receita" ? T.receitas.some(r => r.id === itemId)
                    : null;
        if (achou === null) return "liquidação: tipo desconhecido";
        if (!achou) return "liquidação: compromisso não encontrado";
        /* a unique (user_id, tipo, item_id, competencia): pagar duas vezes o
           mesmo mês do mesmo compromisso é recusado pelo BANCO, não pela tela */
        if (T.liquidacoes.some(l => l.tipo === tipo && l.item_id === itemId
                                 && l.competencia === competencia))
          return "duplicate key value violates unique constraint \\"liquidacao_uma_por_competencia\\"";
        return null;
      };
      const liquida = (tipo, itemId, a2, entrada) => {
        const ruim = confere(tipo, itemId, a2.p_competencia, a2.p_conta, a2.p_valor);
        if (ruim) return Promise.resolve({ data:null, error:{ message:ruim } });
        const t = { id:uid(), user_id:"u1", conta_id:a2.p_conta, categoria_id:a2.p_categoria||null,
                    tipo: entrada ? "entrada" : "saida", natureza:"normal",
                    descricao:a2.p_descricao, valor:a2.p_valor, data:a2.p_data,
                    status:"realizada", origem:tipo, origem_id:itemId, obs:a2.p_obs||"",
                    transferencia_id:null };
        T.transacoes.push(t);
        /* receita NAO entra em pagamentos: receita não é pagamento */
        if (!entrada && !T.pagamentos.some(x => x.mes === a2.p_competencia && x.item_id === itemId))
          T.pagamentos.push({ id:uid(), user_id:"u1", mes:a2.p_competencia, item_id:itemId });
        T.liquidacoes.push({ id:uid(), user_id:"u1", tipo, item_id:itemId,
                             competencia:a2.p_competencia, transacao_id:t.id, valor:a2.p_valor });
        return Promise.resolve({ data:t.id, error:null });
      };
      if (nome === "liquida_compromisso"){
        if (!["divida","fixa"].includes(a.p_tipo))
          return Promise.resolve({ data:null, error:{ message:"liquidação: use recebe_receita para receita" } });
        return liquida(a.p_tipo, a.p_item_id, a, false);
      }
      if (nome === "recebe_receita") return liquida("receita", a.p_receita, a, true);
      if (nome === "desfaz_liquidacao"){
        const l = T.liquidacoes.find(x => x.tipo === a.p_tipo && x.item_id === a.p_item_id
                                       && x.competencia === a.p_competencia);
        if (!l) return Promise.resolve({ data:null, error:{ message:"liquidação: não encontrei o que desfazer" } });
        /* apagar a transação leva o vínculo pelo cascade, e o gatilho leva a
           marca da V1 junto -- as três coisas numa chamada */
        T.transacoes = T.transacoes.filter(t => t.id !== l.transacao_id);
        T.liquidacoes = T.liquidacoes.filter(x => x !== l);
        if (l.tipo !== "receita")
          T.pagamentos = T.pagamentos.filter(x => !(x.mes === l.competencia && x.item_id === l.item_id));
        return Promise.resolve({ data:1, error:null });
      }
      return Promise.resolve({ data:null, error:{ message:"rpc desconhecida: " + nome } });
    },
    auth: {
      onAuthStateChange:(cb)=>{ cb("SIGNED_IN",{user:{id:"u1"}});
        return { data:{ subscription:{ unsubscribe(){} } } }; },
      getSession:()=>Promise.resolve({ data:{ session:{ user:{ id:"u1" } } } }),
      signInWithPassword:()=>Promise.resolve({ error:null }),
      signOut:()=>Promise.resolve({}) } };
}`;

/* ------------------------------------------------------------- placar --*/
let ok = 0, bad = 0;
const eq = (nome, got, want) => {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a === b) ok++;
  else { bad++; console.error(`  ✗ ${nome}\n      esperado ${b}\n      obtido   ${a}`); }
};

const nav = await chromium.launch({ executablePath: CHROMIUM });

async function abreApp(largura){
  const p = await nav.newPage();
  const erros = [];
  p.on("pageerror", (e) => erros.push(String(e).slice(0, 180)));
  p.on("console", (m) => { if (m.type() === "error"){
    const t = m.text();
    /* a rede do contêiner não alcança CDN nem fonte; isso não é defeito do app */
    if (!/ERR_|Failed to load resource|net::/.test(t)) erros.push(t.slice(0, 180));
  } });
  await p.route("**/supabase-js@2/+esm", (r) =>
    r.fulfill({ status:200, contentType:"text/javascript", body: DUBLE }));
  await p.route("**/fonts.googleapis.com/**", (r) =>
    r.fulfill({ status:200, contentType:"text/css", body:"" }));
  await p.setViewportSize({ width: largura, height: 900 });
  await p.goto(`http://127.0.0.1:${PORTA}/index.html`, { waitUntil:"networkidle" });
  await p.waitForTimeout(450);
  return { p, erros };
}

const vaiPara = (p, aba) => p.evaluate((a) => document.getElementById("nav-" + a).click(), aba);

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
   4. ROLAGEM LATERAL: mobile é primeira classe
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
    for (const aba of ["painel", "mes", "contas", "transacoes", "receitas"]){
      await vaiPara(p, aba);
      await p.waitForTimeout(120);
      eq(`sem rolagem lateral em ${largura}px na aba ${aba}`,
        await p.evaluate(() =>
          document.documentElement.scrollWidth - document.documentElement.clientWidth), 0);
    }
  }
  await p.close();
}

await nav.close();
servidor.close();
console.log(`\n${ok} passaram, ${bad} falharam`);
process.exit(bad ? 1 : 0);
