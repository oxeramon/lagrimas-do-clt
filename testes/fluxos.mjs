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
const T = { instituicoes:[], contas:[], categorias:[], transacoes:[],
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
   3. ROLAGEM LATERAL: mobile é primeira classe
   ================================================================== */
console.log("\nrolagem lateral");
{
  const { p } = await abreApp(1440);
  await criaConta(p, "Conta Alfa", 1000, true);
  await criaConta(p, "Conta Beta", 500, false);
  for (const largura of [320, 360, 390, 768, 1366, 1440]){
    await p.setViewportSize({ width: largura, height: 900 });
    for (const aba of ["painel", "contas", "transacoes"]){
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
