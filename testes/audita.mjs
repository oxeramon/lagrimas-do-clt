#!/usr/bin/env node
/* Auditoria de repositório público.
 *
 * Este repositório é público. A regra do projeto é preventiva: dado real não
 * entra no arquivo versionado, nem temporariamente. Este script é a parte
 * automática dessa regra -- ele não substitui a leitura de
 * `.claude/skills/public-repo-hygiene/SKILL.md`, que é onde está o critério.
 *
 *   node testes/audita.mjs            confere os arquivos rastreados pelo git
 *   node testes/audita.mjs --staged   confere só o que está em stage
 *   node testes/audita.mjs --push     confere a árvore e as mensagens dos
 *                                     commits que seriam enviados
 *   node testes/audita.mjs <arquivo>… confere caminhos específicos
 *
 * Sai com código 1 quando encontra qualquer ocorrência CRÍTICA, que é o que o
 * hook e o pre-push usam para bloquear. Aviso aparece e não bloqueia.
 *
 * O cruzamento com valores conhecidos da base real é opcional e mora FORA do
 * repositório -- publicar a lista dos dados proibidos seria publicar os dados.
 * Veja SANITIZATION_BASELINE_PATH no fim deste arquivo e na skill.
 */
import { readFileSync, existsSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const git = (...args) => {
  try { return execFileSync("git", ["-C", RAIZ, ...args], { encoding: "utf8" }); }
  catch { return ""; }
};

/* ---------------------------------------------------------------- exceções --
   As duas únicas credenciais públicas por design. A chave publicável só abre
   alguma coisa com login, porque o RLS limita cada usuário às próprias linhas;
   e sem a URL o frontend não sobe. Qualquer outra credencial é crítica. */
const PERMITIDO = [
  /https:\/\/[a-z0-9]+\.supabase\.co/,     /* SUPABASE_URL */
  /sb_publishable_[A-Za-z0-9_-]+/,         /* chave publicável do frontend */
  /https:\/\/[\w.-]*github\.(com|io)[\w./-]*/,
  /troque@pelo-seu-email\.com/,            /* placeholder de instalação */
  /noreply@[\w.-]+/,                       /* trailer de atribuição, não é caixa de ninguém */
  /[\w.+-]+@(?:example|exemplo)\.[a-z]+/i, /* domínios reservados para documentação */
];
const ehPermitido = (trecho) => PERMITIDO.some((re) => re.test(trecho));

/* ---------------------------------------------------- documentos de política
   CLAUDE.md e a skill de higiene precisam ESCREVER "service_role" e "CPF" para
   proibi-los. Sem esta lista a auditoria acusaria a própria regra que a define.
   Nestes arquivos só as regras que casam com o FORMATO de um segredo de verdade
   continuam valendo -- um JWT ou um ghp_ ali dentro segue sendo crítico. */
const DOCS_DE_POLITICA = [
  /^CLAUDE\.md$/,
  /^\.claude\/skills\/public-repo-hygiene\/SKILL\.md$/,
  /^docs\/ARCHITECTURE_V2\.md$/,
  /^testes\/audita\.mjs$/,
];
const ehDocDePolitica = (rel) => DOCS_DE_POLITICA.some((re) => re.test(rel));

/* ------------------------------------------------------------------ regras --
   `critico` bloqueia commit e push. `aviso` só aparece. Na dúvida, crítico:
   a skill manda tratar o incerto como privado.

   A quarta coluna diz se a regra casa com o FORMATO de um segredo (`valor`) ou
   apenas com o NOME dele (`nome`). Só as de formato valem dentro de um
   documento de política. */
const REGRAS = [
  /* credenciais */
  /* Duas regras montadas por concatenação de propósito: escritas inteiras, o
     literal apareceria no próprio código e a auditoria se acusaria. O padrão
     final é idêntico; o que muda é que a fonte não contém a palavra. */
  ["critico", "service_role", new RegExp("service" + "_role", "i"), "nome"],
  ["critico", "chave secreta Supabase", new RegExp("sb_" + "secret[_A-Za-z0-9-]*"), "valor"],
  ["critico", "JWT", /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+/, "valor"],
  ["critico", "chave privada", /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/, "valor"],
  ["critico", "token GitHub", /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/, "valor"],
  ["critico", "token GitHub (fine-grained)", /\bgithub_pat_[A-Za-z0-9_]{20,}\b/, "valor"],
  ["critico", "chave de IA", /\bsk-(?:ant-)?[A-Za-z0-9_-]{20,}\b/, "valor"],
  ["critico", "token Slack", /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/, "valor"],
  ["critico", "chave AWS", /\bAKIA[0-9A-Z]{16}\b/, "valor"],
  ["critico", "token WhatsApp/Meta", /\bEAA[A-Za-z0-9]{20,}\b/, "valor"],
  ["critico", "senha atribuída", /\b(?:senha|password|passwd|pwd|secret|token|api_?key)\s*[:=]\s*["'][^"'\s]{6,}["']/i, "valor"],

  /* dados pessoais */
  ["critico", "CPF", /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/, "valor"],
  ["critico", "CNPJ", /\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/, "valor"],
  ["critico", "telefone", /\(?\b\d{2}\)?[\s-]?9\d{4}[\s-]?\d{4}\b/, "valor"],
  ["critico", "CEP", /\b\d{5}-\d{3}\b/, "valor"],
  ["critico", "placa de veículo", /\b[A-Z]{3}-?\d[A-Z0-9]\d{2}\b/, "valor"],
  ["critico", "cartão completo", /\b(?:\d[ -]?){13,16}\b/, "valor"],
  ["critico", "e-mail pessoal", /[\w.+-]+@(?!pelo-seu-email|example\.|exemplo\.)[\w-]+\.[a-z]{2,}/i, "valor"],

];

/* Dump e backup se detectam pelo NOME do arquivo, não pelo conteúdo: como
   regra de conteúdo, `*.dump` no .gitignore -- a linha que justamente impede o
   dump de entrar -- era acusada como se fosse o dump. */
const NOME_PROIBIDO = [
  [/\.(?:dump|bak|sqlitedb|sqlite3?)$/i, "dump ou backup versionado"],
  [/(?:^|\/)(?:\.env|\.env\..+)$/i, "arquivo de ambiente com segredos"],
  [/(?:^|\/)id_(?:rsa|ed25519|ecdsa)$/i, "chave privada SSH"],
  [/\.(?:pem|p12|pfx|keystore)$/i, "certificado ou chave"],
];

/* Valor monetário de exemplo tem centavo zerado, por convenção do projeto.
   Extrato de verdade quase nunca produz .00, então centavo diferente de zero
   num arquivo de dado de exemplo é sinal de valor copiado de algum lugar. */
const ARQUIVOS_DE_EXEMPLO = [/supabase-setup\.sql$/, /supabase\/seed\.sql$/,
  /testes\/regras\.mjs$/, /testes\/preview\.mjs$/];
const CENTAVO_VIVO = /\b\d{1,7}[.,]\d{2}\b/g;

/* ------------------------------------------------------------------ leitura */
const BINARIO = /\.(png|jpe?g|gif|webp|avif|ico|pdf|zip|gz|tar|woff2?|ttf|eot|mp4|mp3)$/i;

function listaArquivos(modo, avulsos) {
  if (avulsos.length) return avulsos;
  const saida = modo === "staged"
    ? git("diff", "--cached", "--name-only", "--diff-filter=ACMR")
    : git("ls-files");
  return saida.trim().split("\n").filter(Boolean);
}

/* ------------------------------------------------------------------ baseline
   Opcional e sempre fora do repositório. Sem ele a auditoria roda só a parte
   genérica -- e diz isso, em vez de fingir uma cobertura que não tem. */
function carregaBaseline() {
  const caminho = process.env.SANITIZATION_BASELINE_PATH;
  if (!caminho) return null;
  if (!existsSync(caminho)) {
    console.error("  aviso: SANITIZATION_BASELINE_PATH aponta para um arquivo "
      + "que não existe; seguindo só com a auditoria genérica.");
    return null;
  }
  const dentroDoRepo = resolve(caminho).startsWith(RAIZ + "/");
  if (dentroDoRepo) {
    console.error("  ERRO: o baseline está DENTRO do repositório. Ele é a lista "
      + "dos dados proibidos: publicá-la é publicar os dados. Mova para fora.");
    process.exit(1);
  }
  try {
    const b = JSON.parse(readFileSync(caminho, "utf8"));
    return {
      termos: b.termos || [], valores: b.valores || [],
      datas: b.datas || [], combinacoes: b.combinacoes || [],
    };
  } catch (e) {
    console.error("  aviso: não deu para ler o baseline (" + e.message + ").");
    return null;
  }
}

/* -------------------------------------------------------------------- varre */
const achados = [];
const anota = (nivel, regra, arquivo, linha, trecho) =>
  achados.push({ nivel, regra, arquivo, linha, trecho: trecho.trim().slice(0, 90) });

function varreArquivo(rel, baseline) {
  for (const [re, motivo] of NOME_PROIBIDO)
    if (re.test(rel)) anota("critico", motivo, rel, 0, "(o arquivo não deveria estar versionado)");

  const abs = join(RAIZ, rel);
  if (!existsSync(abs) || BINARIO.test(rel)) return;
  try { if (statSync(abs).isDirectory()) return; } catch { return; }
  let texto;
  try { texto = readFileSync(abs, "utf8"); } catch { return; }

  const politica = ehDocDePolitica(rel);
  /* O <style> do index.html é cheio de número com duas casas -- line-height,
     clamp, brightness. Nenhum deles é dinheiro, e cruzá-los com um baseline de
     valores dá alarme falso em série. O CSS entra nas regras de segredo, que
     valem em qualquer lugar, e fica fora do cruzamento por valor. */
  const faixaCss = (() => {
    const ini = texto.indexOf("<style>"), fim = texto.indexOf("</style>");
    if (ini < 0 || fim < 0) return [-1, -1];
    const ate = (p) => texto.slice(0, p).split("\n").length;
    return [ate(ini), ate(fim)];
  })();
  const ehCss = (n) => n >= faixaCss[0] && n <= faixaCss[1];

  texto.split("\n").forEach((linha, i) => {
    for (const [nivel, regra, re, tipo] of REGRAS) {
      if (politica && tipo === "nome") continue;
      const m = linha.match(re);
      if (m && !ehPermitido(m[0])) anota(nivel, regra, rel, i + 1, linha);
    }
    if (baseline) {
      /* termo vale em qualquer lugar: nome de pessoa ou de banco não tem por
         que aparecer nem dentro do CSS */
      for (const t of baseline.termos)
        if (t && linha.includes(t)) anota("critico", "termo do baseline privado", rel, i + 1, linha);
      if (!ehCss(i + 1)) {
        for (const v of baseline.valores)
          if (v && linha.includes(v)) anota("critico", "valor do baseline privado", rel, i + 1, linha);
        for (const d of baseline.datas)
          if (d && linha.includes(d)) anota("critico", "data do baseline privado", rel, i + 1, linha);
        for (const c of baseline.combinacoes) {
          const [a, b] = String(c).split("/");
          /* 1/1 é pagamento à vista: aparece em qualquer fixture e não
             identifica nada. Combinação trivial não entra. */
          if (!a || !b || (a === "1" && b === "1")) continue;
          if (new RegExp("\\b" + a + "\\s*,\\s*" + b + "\\b").test(linha))
            anota("critico", "combinação do baseline privado", rel, i + 1, linha);
        }
      }
    }
  });

  if (ARQUIVOS_DE_EXEMPLO.some((re) => re.test(rel))) {
    texto.split("\n").forEach((linha, i) => {
      if (/^\s*(--|\/\*|\*|\/\/)/.test(linha)) return;          /* comentário não é dado */
      for (const v of linha.match(CENTAVO_VIVO) || []) {
        if (/[.,]00$/.test(v)) continue;
        if (/^\d\.\d{2}$/.test(v)) continue;                    /* 0.01, 1.15: CSS/step */
        anota("aviso", "valor de exemplo com centavo não zerado", rel, i + 1, linha);
      }
    });
  }
}

/* mensagens dos commits que seriam enviados */
function varreMensagens(baseline) {
  const remoto = git("rev-parse", "--abbrev-ref", "@{upstream}").trim();
  const faixa = remoto ? remoto + "..HEAD" : "HEAD";
  const msgs = git("log", "--format=%H%x00%B%x00", faixa).split("\0\n");
  for (const bruto of msgs) {
    const [sha, corpo] = bruto.split("\0");
    if (!sha || !corpo) continue;
    corpo.split("\n").forEach((linha, i) => {
      for (const [nivel, regra, re, tipo] of REGRAS) {
        /* Só regras de FORMATO valem numa mensagem de commit. Explicar que uma
           correção mexeu na regra de service_role é descrição técnica legítima
           e não vaza nada; um JWT colado ali continua sendo crítico. */
        if (tipo === "nome") continue;
        const m = linha.match(re);
        if (m && !ehPermitido(m[0]))
          anota(nivel, "mensagem de commit: " + regra, sha.slice(0, 7), i + 1, linha);
      }
      if (baseline)
        for (const t of [...baseline.termos, ...baseline.valores])
          if (t && linha.includes(t))
            anota("critico", "mensagem de commit: baseline privado", sha.slice(0, 7), i + 1, linha);
    });
  }
}

/* ------------------------------------------------------------------- saída  */
const argv = process.argv.slice(2);
const modo = argv.includes("--staged") ? "staged" : argv.includes("--push") ? "push" : "arvore";
const avulsos = argv.filter((a) => !a.startsWith("--"));

const baseline = carregaBaseline();
const arquivos = listaArquivos(modo === "staged" ? "staged" : "arvore", avulsos);
for (const a of arquivos) varreArquivo(a, baseline);
if (modo === "push") varreMensagens(baseline);

const criticos = achados.filter((a) => a.nivel === "critico");
const avisos = achados.filter((a) => a.nivel === "aviso");

console.log("auditoria de repositório público · " + arquivos.length + " arquivo(s) · modo " + modo);
console.log(baseline
  ? "  baseline privado: carregado de fora do repositório"
  : "  baseline privado: ausente (só auditoria genérica) — defina SANITIZATION_BASELINE_PATH para cruzar com valores conhecidos");

const mostra = (lista, titulo) => {
  if (!lista.length) return;
  console.log("\n" + titulo);
  for (const a of lista) console.log("  [" + a.regra + "] " + a.arquivo + ":" + a.linha + "\n      " + a.trecho);
};
mostra(criticos, "CRÍTICO — bloqueia commit e push:");
mostra(avisos, "aviso — confira, não bloqueia:");

console.log("\n" + (criticos.length
  ? "RESULTADO: " + criticos.length + " ocorrência(s) crítica(s). Corrija antes de versionar."
  : "RESULTADO: zero ocorrências críticas" + (avisos.length ? " (" + avisos.length + " aviso(s))" : "")));
process.exit(criticos.length ? 1 : 0);
