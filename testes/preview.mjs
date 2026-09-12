/* Gera preview.html: uma cópia do index.html com o cliente Supabase dublado
   e dados de exemplo, para olhar a tela sem logar no banco de verdade.

     node testes/preview.mjs && start preview.html

   O arquivo gerado fica fora do git (.gitignore). Nada aqui vai para o ar.

   Todos os dados abaixo são FICTÍCIOS e foram montados de propósito para este
   arquivo: nomes genéricos, ciclos de cartão escolhidos a dedo, e valores com
   centavos zerados que nenhum extrato produziria. Este repositório é público, e
   prévia não é lugar de dado financeiro real.

   O cenário existe para exercitar o modelo de três eixos — credor (de quem se
   deve), meio (como se paga), categoria (no que foi) — e não só para encher a
   tela. Ele tem, de propósito:

     · um banco com dois cartões pendurados nele, com ciclos diferentes
       (fecha 10 e fecha 25), que viram duas faturas dentro do mesmo credor;
     · financiamento e empréstimo lançados no próprio banco, sem fatura;
     · uma loja com carnê e uma pessoa, que também não;
     · assinaturas cobradas no cartão, que entram na fatura do cartão certo;
     · um credor desativado, que sai das listas sem apagar o histórico.  */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname, normalize } from "node:path";

const raiz = new URL("../", import.meta.url);
const ENTRADA = fileURLToPath(new URL("index.html", raiz));
const SAIDA = fileURLToPath(new URL("preview.html", raiz));

/* nome, tipo, fecha, vence, ativo, pertence a

   O banco é o credor; o cartão é produto dele. Só o cartão precisa de
   fechamento, porque só ele emite fatura. Financiamento e empréstimo são
   lançados direto no banco: não passam por fatura, então não viram produto. */
const CREDORES = [
  ["Banco Exemplo",       "Banco",  null, null, true,  null],
  ["Cartão Principal",    "Cartão",   10,   20, true,  "Banco Exemplo"],
  ["Cartão Secundário",   "Cartão",   25,    8, true,  "Banco Exemplo"],
  ["Loja Exemplo",        "Loja",   null, null, true,  null],
  ["Pessoa A",            "Pessoa", null, null, true,  null],
  ["Cartão Encerrado",    "Cartão",   18,   26, false, null],
  ["Pessoa B",            "Pessoa", null, null, true,  null],
];

/* credor, descrição, categoria, meio, valor, parcela, total, mês, data, [quem divide, quanto é dele]

   Nas linhas de cartão a data e o mês precisam ser coerentes com o fechamento:
   no Principal (fecha 10, vence 20) a fatura de setembro leva compras de 10/08
   a 09/09; no Secundário (fecha 25, vence 8) a de setembro leva de 01/08 a
   24/08. A conferência no fim do arquivo reclama se eu errar uma linha. */
const CARTAO = "Cartão de crédito";
const DIVIDAS = [
  /* ---- Principal: fatura de setembro ---- */
  ["Cartão Principal",  "Delivery Exemplo",     "Alimentação", CARTAO,  37.00, 1,  1, "2026-09", "2026-08-12"],
  ["Cartão Principal",  "Lavanderia Exemplo",   "Serviços",    CARTAO,  19.00, 1,  1, "2026-09", "2026-08-17"],
  ["Cartão Principal",  "Transporte por app",   "Transporte",  CARTAO,  64.00, 1,  1, "2026-09", "2026-08-20"],
  ["Cartão Principal",  "Transporte por app",   "Transporte",  CARTAO,  28.00, 1,  1, "2026-09", "2026-09-02"],
  ["Cartão Principal",  "Seguro Exemplo",       "Serviços",    CARTAO, 233.00, 3, 30, "2026-09", "2026-07-14"],
  ["Cartão Principal",  "Eletrônico Exemplo",   "Compras",     CARTAO, 188.00, 2,  6, "2026-09", "2026-07-19"],
  /* ---- Principal: fatura de outubro ---- */
  ["Cartão Principal",  "Passagem Exemplo",     "Viagem",      CARTAO, 141.00, 1,  1, "2026-10", "2026-09-11"],
  ["Cartão Principal",  "Compra Exemplo",       "Compras",     CARTAO,  17.00, 1,  1, "2026-10", "2026-09-16"],
  ["Cartão Principal",  "Delivery Exemplo",     "Alimentação", CARTAO,  29.00, 1,  1, "2026-10", "2026-09-22"],
  ["Cartão Principal",  "Academia Exemplo",     "Saúde",       CARTAO, 133.00, 1,  1, "2026-10", "2026-09-27"],
  ["Cartão Principal",  "Transporte por app",   "Transporte",  CARTAO,  72.00, 1,  1, "2026-10", "2026-10-03"],
  /* ---- Secundário: mesmo banco, outro ciclo ---- */
  ["Cartão Secundário", "Combustível Exemplo",  "Transporte",  CARTAO, 166.00, 1,  1, "2026-09", "2026-08-06"],
  ["Cartão Secundário", "Transporte por app",   "Transporte",  CARTAO,  43.00, 1,  1, "2026-09", "2026-08-13"],
  ["Cartão Secundário", "Assinatura Exemplo",   "Assinaturas", CARTAO,   7.00, 1,  1, "2026-09", "2026-08-21"],
  ["Cartão Secundário", "Compra Exemplo",       "Compras",     CARTAO,  96.00, 1,  5, "2026-10", "2026-09-08"],
  /* ---- mesmo banco, sem fatura: cada parcela vence sozinha ---- */
  ["Banco Exemplo", "Financiamento Exemplo", "Transporte", "Financiamento", 1111.00, 15, 40, "2026-09", null],
  ["Banco Exemplo", "Empréstimo Exemplo",    "Outros",     "Empréstimo",     666.00,  6, 15, "2026-09", null],
  /* ---- nem loja nem pessoa viram fatura ---- */
  ["Loja Exemplo", "Eletrodoméstico Exemplo", "Moradia", "Carnê",           137.00, 10, 18, "2026-09", null],
  ["Pessoa A",     "Evento Exemplo",          "Lazer",   "Pix", 444.00,  7, 14, "2026-09", null, "Pessoa B", 222.00],
  ["Pessoa A",     "Ingresso Exemplo",        "Lazer",   "Pix", 260.00,  1,  1, "2026-09", null, "Pessoa B", 130.00],
];

/* nome, valor, categoria, meio, credor (vazio = fora de fatura), obs, varia? */
const FIXAS = [
  ["Aluguel Exemplo",        1333.00, "Moradia",     "Débito automático", "",                   "contrato até mar/27"],
  ["Condomínio Exemplo",      377.00, "Moradia",     "Boleto",            "",                   "vence dia 10", true],
  ["Energia Exemplo",         162.00, "Moradia",     "Débito automático", "",                   "valor varia", true],
  ["Assinatura de vídeo",      39.00, "Assinaturas", CARTAO,              "Cartão Principal",   ""],
  ["Assinatura de música",     17.00, "Assinaturas", CARTAO,              "Cartão Secundário",  ""],
  ["Custo de vida variável", 1122.00, "Alimentação", "Pix",               "",                   "mercado, transporte"],
];

const idDe = new Map();
/* o pai vem antes do filho na lista, então o id dele já existe aqui */
const credores = CREDORES.map(([nome, tipo, fecha, vence, ativo, pai], i) => {
  idDe.set(nome, "c" + i);
  return { id: "c" + i, nome, tipo, contato: "", obs: "", ordem: (i + 1) * 10,
           ativo, dia_fechamento: fecha, dia_vencimento: vence,
           credor_pai_id: pai ? idDe.get(pai) : null };
});

const DB = {
  dividas: DIVIDAS.map(([credor, descricao, categoria, meio, valor, pi, tot, mes, data, quem, quanto], i) => ({
    id: "d" + i, credor, credor_id: idDe.get(credor), descricao, categoria, meio,
    valor, parcela_inicial: pi, total_parcelas: tot, mes_inicial: mes,
    data_compra: data, obs: "", ordem: (i + 1) * 10,
    pessoa_id: quem ? idDe.get(quem) : null, valor_terceiro: quanto || 0,
  })),
  fixas: FIXAS.map(([nome, valor, categoria, meio, credor, obs, varia], i) => ({
    id: "f" + i, nome, valor, categoria, meio, credor,
    credor_id: idDe.get(credor) || null, obs, ordem: (i + 1) * 10,
    variavel: !!varia,
  })),
  /* energia de setembro já chegou; condomínio ainda não -- os dois estados na
     mesma tela, que é como a coisa realmente fica */
  fixas_mes: [{ mes: "2026-09", fixa_id: "f2", valor: 183.00 }],
  credores,
  receitas: [
    { id: "r1", descricao: "Aluguel recebido", categoria: "Aluguel", valor: 888, tipo: "mensal", mes_inicial: null, mes_final: null, obs: "", ordem: 10 },
    { id: "r2", descricao: "Serviço Exemplo", categoria: "Freelance", valor: 2750, tipo: "pontual", mes_inicial: "2026-11", mes_final: null, obs: "metade na entrega", ordem: 20 },
    { id: "r3", descricao: "Adicional Exemplo", categoria: "Bônus", valor: 470, tipo: "mensal", mes_inicial: "2026-10", mes_final: "2027-03", obs: "", ordem: 30 },
    { id: "r4", descricao: "13º salário", categoria: "Extra", valor: 3900, tipo: "pontual", mes_inicial: "2026-12", mes_final: null, obs: "", ordem: 40 },
  ],
  /* setembro meio pago: a fatura do Secundário quitada, o aluguel e a energia em dia */
  pagamentos: [
    { mes: "2026-09", item_id: "d11" }, { mes: "2026-09", item_id: "d12" },
    { mes: "2026-09", item_id: "d13" }, { mes: "2026-09", item_id: "fx:f4" },
    { mes: "2026-09", item_id: "fx:f0" }, { mes: "2026-09", item_id: "fx:f2" },
  ],
  config: { renda: 7400 },
};

/* ---- conferência: o mês declarado tem que bater com o ciclo do cartão ----
   Dado de exemplo errado é pior que dado nenhum: a tela fica plausível e
   esconde o defeito. Então o gerador confere antes de escrever. */
const midx = k => { const p = k.split("-"); return (+p[0]) * 12 + (+p[1]) - 1; };
const fromIdx = i => Math.floor(i / 12) + "-" + String(i % 12 + 1).padStart(2, "0");
const faturaDaCompra = (iso, fecha, vence) => {
  if (!iso || !fecha) return null;
  const p = String(iso).split("-");
  let m = midx(p[0] + "-" + p[1]);
  if (+p[2] >= fecha) m += 1;
  return fromIdx(m + ((vence && vence > fecha) ? 0 : 1));
};
const porNome = Object.fromEntries(CREDORES.map(c => [c[0], c]));
let erros = 0;
for (const [credor, desc, , meio, , pi, , mes, data] of DIVIDAS) {
  /* só a primeira parcela nasce na fatura da compra; as seguintes são derivadas */
  if (meio !== CARTAO || !data || pi !== 1) continue;
  const [, , fecha, vence] = porNome[credor];
  const esperado = faturaDaCompra(data, fecha, vence);
  if (esperado !== mes) {
    console.error("  INCOERENTE: " + credor + " / " + desc + " comprado em " + data
      + " cairia na fatura de " + esperado + ", não em " + mes);
    erros++;
  }
}
if (erros) {
  console.error("\n" + erros + " linha(s) com mês fora do ciclo do cartão.");
  process.exit(1);
}

const stub = `
/* ===== Dublê do Supabase: só para inspeção visual, nunca publicado ===== */
const __DB = ${JSON.stringify(DB)};
function createClient(){
  const resp = (data) => {
    const p = Promise.resolve({ data, error: null });
    const api = {
      select: () => api, order: () => api, eq: () => api, limit: () => api,
      insert: () => api, update: () => api, upsert: () => api, delete: () => api,
      maybeSingle: () => p, single: () => p,
      then: (a, b) => p.then(a, b),
    };
    return api;
  };
  return {
    from: (t) => resp(__DB[t] ?? []),
    auth: {
      onAuthStateChange: (cb) => { cb("SIGNED_IN", { user: { id: "u1" } });
        return { data: { subscription: { unsubscribe(){} } } }; },
      getSession: () => Promise.resolve({ data: { session: { user: { id: "u1" } } } }),
      signInWithPassword: () => Promise.resolve({ error: null }),
      signOut: () => Promise.resolve({}),
    },
  };
}
`;

const IMPORT = 'import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";';
const html = readFileSync(ENTRADA, "utf8");
if (!html.includes(IMPORT)) {
  console.error("FALHA: não achei a linha de import do supabase-js no index.html.");
  process.exit(1);
}

/* ---- por que a prévia precisa embutir os módulos -----------------------
   O navegador RECUSA `import` a partir de file://: o módulo vem de origem
   "null" e a política de CORS barra. No ar isso não existe, porque o Pages
   serve tudo por HTTPS e o import resolve normalmente -- continua sem bundler
   e sem passo de build para produção.

   Mas a prévia é feita para ser aberta como arquivo, com dois cliques. Então
   aqui, e SÓ aqui, o grafo de módulos é achatado num script só. É ferramenta
   de inspeção local, não empacotamento de produção.

   O achatamento é deliberadamente burro, e pode ser porque o estilo dos
   módulos do projeto é uniforme: só `import { … } from "./caminho.js"` e só
   `export const` / `export function`. Nada de default, de `export {}` no fim,
   de renomeação nem de import dinâmico. Se alguém introduzir uma dessas, o
   gerador para e diz -- em vez de gerar uma prévia sutilmente errada. */
const RAIZ_JS = fileURLToPath(raiz);

function leModulo(rel){
  try { return readFileSync(join(RAIZ_JS, rel), "utf8"); }
  catch { console.error("FALHA: módulo não encontrado: " + rel); process.exit(1); }
}

const RE_IMPORT = /^import\s*\{([^}]*)\}\s*from\s*["'](\.[^"']+)["'];?\s*$/gm;

/* percorre o grafo em profundidade, dependência antes de quem depende */
function ordena(relInicial, vistos = new Set(), ordem = []){
  if (vistos.has(relInicial)) return ordem;
  vistos.add(relInicial);
  const fonte = leModulo(relInicial);
  const base = dirname(relInicial);
  for (const m of fonte.matchAll(RE_IMPORT)){
    const alvo = normalize(join(base, m[2]));
    ordena(alvo, vistos, ordem);
  }
  ordem.push(relInicial);
  return ordem;
}

function achata(fonte, rel){
  const semImport = fonte.replace(RE_IMPORT, "");
  if (/^\s*export\s+(default|\{)/m.test(semImport)){
    console.error("FALHA: " + rel + " usa `export default` ou `export {}`, que o "
      + "achatamento da prévia não sabe resolver. Use `export const` / `export function`.");
    process.exit(1);
  }
  if (/^\s*import\s/m.test(semImport)){
    console.error("FALHA: sobrou um import em " + rel + " que o gerador não reconheceu. "
      + "A prévia só entende `import { … } from \"./caminho.js\"`.");
    process.exit(1);
  }
  return semImport.replace(/^export\s+/gm, "");
}

/* os módulos que o index.html importa, na ordem em que aparecem */
const doIndex = [...html.matchAll(RE_IMPORT)].map(m => normalize(m[2].replace(/^\.\//, "")));
const ordem = [];
for (const rel of doIndex) ordena(rel, new Set(ordem.map(x => x)), ordem);

/* nome exportado duas vezes viraria colisão silenciosa no escopo único */
const donoDe = new Map();
for (const rel of ordem){
  for (const m of leModulo(rel).matchAll(/^export\s+(?:const|let|function)\s+([A-Za-z_$][\w$]*)/gm)){
    if (donoDe.has(m[1])){
      console.error("FALHA: `" + m[1] + "` é exportado por " + donoDe.get(m[1]) + " e por "
        + rel + ". No achatamento da prévia os dois caem no mesmo escopo.");
      process.exit(1);
    }
    donoDe.set(m[1], rel);
  }
}

const embutidos = ordem.map(rel =>
  "/* ===== " + rel + " ===== */\n" + achata(leModulo(rel), rel)).join("\n");

const corpo = html
  .replace(IMPORT, stub)
  .replace(RE_IMPORT, "")
  .replace(stub, stub + "\n" + embutidos + "\n");

writeFileSync(SAIDA, corpo, "utf8");
console.log("preview.html gerado: " + credores.length + " credores, "
  + DIVIDAS.length + " lançamentos, " + FIXAS.length + " contas fixas, "
  + ordem.length + " módulos embutidos.");
