/* O ARREIO DE NAVEGADOR · servidor, dublê do Supabase e abertura do app.
 *
 * Isto era o topo de `testes/fluxos.mjs`. Saiu de lá quando `testes/rotas.mjs`
 * apareceu: os dois precisam do MESMO dublê, e duplicar trezentas linhas de
 * dublê é garantir que um dia eles divirjam e a divergência passe por
 * diferença de comportamento do app.
 *
 * O dublê guarda estado, aplica insert e update, recalcula `saldos_de_conta`
 * como a view faria, e implementa as RPCs com a MESMA regra das migrações.
 * Assim, quando os testes de navegador e os de `supabase/testes/` concordam, a
 * concordância significa alguma coisa.
 *
 * Tudo sintético. Nenhum valor, nome ou identificador vem de base nenhuma.
 *
 * Precisa do Playwright e de um Chromium; nenhum dos dois é dependência de
 * produção. Quem importa este módulo confere `disponivel` e sai com zero em vez
 * de reprovar quem não montou o ambiente -- ver `exigeNavegador()`.
 */
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
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

/* Por que não sair daqui: um `process.exit` dentro de módulo importado encerra
   o processo de quem importou sem ele ter dito nada. Quem chama decide. */
export const disponivel = Boolean(chromium) && existsSync(CHROMIUM);
export function exigeNavegador(nome){
  if (!chromium){
    console.log(`${nome}: Playwright não encontrado — pulando (não é dependência de produção).`);
    process.exit(0);
  }
  if (!existsSync(CHROMIUM)){
    console.log(`${nome}: Chromium não encontrado em ${CHROMIUM} — pulando.`);
    console.log("        defina CHROMIUM_PATH para apontar para um navegador.");
    process.exit(0);
  }
}

/* ------------------------------------------------------------- servidor --
   O navegador RECUSA `import` a partir de file://. Servir por HTTP é o mesmo
   que o GitHub Pages faz, então o que passa aqui passa lá.

   O QUE É SERVIDO. Por padrão, o repositório. Com `SERVIR_ARTEFATO=1`, o
   artefato que `ferramentas/artefato.mjs` constrói -- que é o que o Pages
   publica de verdade. Rodar a MESMA suíte contra os dois é a prova de que a
   poda não tirou nada de que o site precisa: se um módulo tivesse ficado
   fora da whitelist, os fluxos quebrariam aqui, e não no navegador de quem
   abriu o site.

   O artefato é construído do zero na hora, nunca reaproveitado: um `_site`
   velho esconde justamente o arquivo que acabou de sair da lista. */
let SERVIDA = RAIZ;
if (process.env.SERVIR_ARTEFATO){
  const { constroi } = await import("../ferramentas/artefato.mjs");
  SERVIDA = join(RAIZ, "_site");
  const arquivos = constroi(SERVIDA);
  console.log(`servindo o ARTEFATO (${arquivos.length} arquivos), não a raiz do repositório.`);
}

const TIPO = { ".html":"text/html", ".js":"text/javascript", ".css":"text/css",
               ".json":"application/json", ".svg":"image/svg+xml" };
const servidor = createServer((req, res) => {
  const alvoBruto = join(SERVIDA, decodeURIComponent(req.url.split("?")[0]));
  const alvo = existsSync(alvoBruto) && statSync(alvoBruto).isDirectory()
    ? join(alvoBruto, "index.html") : alvoBruto;
  if (!existsSync(alvo) || !alvo.startsWith(SERVIDA)){ res.writeHead(404); return res.end("404"); }
  res.writeHead(200, { "content-type": TIPO[extname(alvo)] || "application/octet-stream" });
  res.end(readFileSync(alvo));
});
export const PORTA = Number(process.env.PORTA_TESTE || 8093);
await new Promise((ok) => servidor.listen(PORTA, "127.0.0.1", ok));
export const fechaServidor = () => servidor.close();

/* --------------------------------------------------------------- dublê --*/

const DUBLE = `
const VAZIO = { instituicoes:[], contas:[], categorias:[], transacoes:[], liquidacoes:[],
            metas:[], alocacoes_de_meta:[], competencias_de_regra:[],
            cartoes:[], faturas:[], compras_de_cartao:[], assinaturas:[],
            dividas:[], fixas:[], credores:[], receitas:[], pagamentos:[], fixas_mes:[], config:[] };

/* O DUBLE SOBREVIVE A UM RELOAD, e precisa sobreviver: sem isto nao da para
   testar "recarregue e veja que a decisao persiste", que e metade do contrato
   de competencias -- uma competencia ignorada que voltasse depois do F5 seria
   o defeito, e o teste nao conseguiria nem chegar la.
   sessionStorage e por aba e morre com ela, entao um teste nao contamina o
   seguinte. Cada aba nova comeca vazia, como antes. */
const CHAVE = "__duble__";
let T, seq = 0;
try {
  const bruto = sessionStorage.getItem(CHAVE);
  const salvo = bruto ? JSON.parse(bruto) : null;
  T = salvo ? { ...VAZIO, ...salvo.T } : { ...VAZIO };
  seq = salvo ? salvo.seq : 0;
} catch { T = { ...VAZIO }; }

const salva = () => {
  try { sessionStorage.setItem(CHAVE, JSON.stringify({ T, seq })); } catch {}
};
const uid = () => { const id = "id-" + (++seq); salva(); return id; };
globalThis.__T = T;
globalThis.__salvaDuble = salva;
/* Grava ANTES de a pagina sair. Assim vale para tudo -- insert, update, delete
   e ate o que o proprio teste mexe direto em __T -- sem espalhar chamadas de
   salvamento por cada caminho de escrita, que e onde uma acabaria esquecida. */
addEventListener("beforeunload", salva);
addEventListener("pagehide", salva);

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
/* a view faturas_resolvidas, recalculada como a 007 faria. Total, pago e
   situação são DERIVADOS aqui também -- se o dublê guardasse status, ele
   deixaria de provar que apagar o pagamento reabre a fatura sozinho. */
function faturasResolvidas(){
  const hoje = new Date().toISOString().slice(0,10);
  return T.faturas.map(f => {
    const itens = T.transacoes.filter(t => t.fatura_id === f.id
      && ["realizada","conciliada"].includes(t.status));
    /* N pagamentos desde a 012, não um. E o pago é SOMA: se o dublê pegasse só
       o primeiro, ele concordaria com uma tela errada, que é o pior que um
       dublê pode fazer. */
    const pagos = T.liquidacoes.filter(x => x.tipo === "fatura" && x.item_id === f.id);
    const total = itens.reduce((s,t) =>
      s + (t.tipo === "entrada" ? -Number(t.valor) : Number(t.valor)), 0);
    const pago = pagos.reduce((s,l) => s + Number(l.valor), 0);
    return { fatura_id:f.id, user_id:"u1", cartao_id:f.cartao_id, competencia:f.competencia,
             abertura:f.abertura, fechamento:f.fechamento, vencimento:f.vencimento, obs:"",
             total, itens: itens.length, pago,
             restante: total - pago,
             pagamentos: pagos.length,
             /* "paga" exige ter havido o que pagar: fatura vazia não é quitada */
             situacao: (total > 0 && pago >= total) ? "paga"
                     : pago > 0 ? "parcial"
                     : (hoje >= f.fechamento ? "fechada" : "aberta") };
  });
}
/* a view assinaturas_resolvidas: custo equivalente e próxima cobrança, os dois
   DERIVADOS -- guardar a próxima cobrança seria guardar algo que envelhece */
const POR_ANO = { semanal:52, mensal:12, bimestral:6, trimestral:4, semestral:2, anual:1 };
function assinaturasResolvidas(){
  const hoje = new Date().toISOString().slice(0,10);
  return T.assinaturas.map(a => {
    const anual = Math.round(a.valor * POR_ANO[a.frequencia] * 100) / 100;
    const prox = T.transacoes
      .filter(t => t.assinatura_id === a.id && t.status === "prevista" && t.data >= hoje)
      .map(t => t.data).sort()[0] || null;
    return { ...a, custo_anual:anual, custo_mensal:Math.round(anual / 12 * 100) / 100,
             proxima_cobranca:prox };
  });
}
/* a view metas_resolvidas: reservado, falta e percentual DERIVADOS -- se o
   duble guardasse reservado, ele deixaria de provar que apagar a alocacao
   devolve a meta ao que era. */
function metasResolvidas(){
  const hoje = new Date();
  return T.metas.map(m => {
    const alocs = T.alocacoes_de_meta.filter(a => a.meta_id === m.id);
    const reservado = alocs.reduce((s,a) => s + Number(a.valor), 0);
    let meses = null;
    if (m.prazo){
      const fim = new Date(m.prazo + "T00:00:00Z");
      meses = Math.max(1, (fim.getUTCFullYear() - hoje.getUTCFullYear()) * 12
                        + (fim.getUTCMonth() - hoje.getUTCMonth()) + 1);
    }
    return { meta_id:m.id, user_id:"u1", nome:m.nome, valor_alvo:Number(m.valor_alvo),
             prazo:m.prazo || null, prioridade:Number(m.prioridade ?? 2),
             cor:m.cor||"", icone:m.icone||"", status:m.status||"ativa", obs:m.obs||"",
             ordem:m.ordem||0, criado_em:m.criado_em||null,
             reservado,
             falta: Math.max(Number(m.valor_alvo) - reservado, 0),
             alocacoes: alocs.length,
             percentual: Math.min(Math.round(reservado * 100 / Number(m.valor_alvo)), 100),
             meses_ate_prazo: meses,
             /* a regra vem CRUA da tabela: a view so repassa as duas colunas */
             /* as TRES colunas de regra, como a view do banco devolve depois
                da 018. O dublê tinha esta terceira antes de o banco ter, e foi
                por isso que ele escondeu o defeito: duble escrito a partir do
                modelo mente quando o modelo e o catalogo discordam. */
             regra_valor: m.regra_valor == null ? null : Number(m.regra_valor),
             regra_ativa: m.regra_ativa === true,
             regra_desde: m.regra_desde || null };
  });
}

const linhasDe = (t) => t === "saldos_de_conta" ? saldos()
                      : t === "metas_resolvidas" ? metasResolvidas()
                      : t === "faturas_resolvidas" ? faturasResolvidas()
                      : t === "assinaturas_resolvidas" ? assinaturasResolvidas()
                      : (T[t] || []);

/* O cliente dublado tambem fica em globalThis.__SB. E a unica forma de um
   teste provar uma garantia do BANCO que a tela esconde: depois de aplicar a
   regra do mes, o botao some, e sem uma porta de tras nao da para tentar a
   segunda aplicacao pela qual a idempotencia responde. */
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
        /* O GATILHO DA 014, reproduzido: a soma das alocacoes nunca passa do
           saldo LIVRE. Sem isto o duble aceitaria reservar dinheiro que nao
           existe, e o teste concordaria com um produto que nao existe. */
        if (tabela === "alocacoes_de_meta"){
          const livre = saldos().filter(s => {
            const c = T.contas.find(y => y.id === s.conta_id);
            return !c || (c.liquidez || "livre") === "livre";
          }).reduce((s,y) => s + Number(y.saldo), 0);
          const depois = T.alocacoes_de_meta.concat(arr)
            .reduce((s,a) => s + Number(a.valor), 0);
          if (depois > livre)
            return Promise.resolve({ data:null, error:{ message:
              "meta: não dá para reservar " + depois.toFixed(2) + " com "
              + livre.toFixed(2) + " livre em conta. Meta é envelope, não dinheiro novo." } });
        }
        T[tabela] = (T[tabela]||[]).concat(arr);
        const pr = Promise.resolve({ data:arr, error:null });
        /* single() devolve a LINHA, nao a lista de uma linha -- e o que o
           PostgREST faz, e o que o app espera ao ler o id recem-criado.
           E select() precisa continuar oferecendo single(): a V1 salva divida
           com insert(...).select(...).single(), e sem este elo o encadeamento
           morria em "single is not a function". Nenhum teste via, porque
           nenhum chegava a salvar uma divida pela tela.
           (Sem crase: este comentario mora dentro do template do duble.) */
        const um = Promise.resolve({ data:arr[0]||null, error:null });
        const apos = { single:()=>um, maybeSingle:()=>um, then:(a,b)=>pr.then(a,b) };
        return { select:()=>apos, single:()=>um, maybeSingle:()=>um,
                 then:(a,b)=>pr.then(a,b) };
      },
      update:(x)=>({ eq:(k,v)=>{ (T[tabela]||[]).forEach(r=>{ if(r[k]===v) Object.assign(r,x); });
        return Promise.resolve({ data:null, error:null }); } }),
      upsert:()=>Promise.resolve({ data:null, error:null }),
      delete:()=>({ eq:(k,v)=>{ T[tabela]=(T[tabela]||[]).filter(r=>r[k]!==v);
        /* cascade: apagar a transação leva o vínculo junto, e com ele a
           situação "paga" da fatura, que é derivada */
        if (tabela === "transacoes" && k === "id")
          T.liquidacoes = T.liquidacoes.filter(l => l.transacao_id !== v);
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
      /* --- assinaturas, mesma regra da 008 --- */
      if (nome === "materializa_assinaturas"){
        const hoje = new Date();
        const iso = (d) => d.toISOString().slice(0,10);
        const limite = a.p_ate || iso(new Date(Date.UTC(
          hoje.getUTCFullYear(), hoje.getUTCMonth() + 2, hoje.getUTCDate())));
        let criadas = 0;
        /* Avanca uma ocorrencia. Semanal anda em DIAS; o resto anda em MESES.
           Somar 7 dias com setMonth daria mes errado, e somar meses com
           setDate daria semana errada -- os dois eixos sao mesmo diferentes. */
        const proxima = (d, freq) => freq === "semanal"
          ? new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 7))
          : new Date(Date.UTC(d.getUTCFullYear(),
              d.getUTCMonth() + { mensal:1, bimestral:2, trimestral:3, semestral:6, anual:12 }[freq],
              d.getUTCDate()));
        for (const s of T.assinaturas){
          /* SEM excecao para semanal: a 011 trocou a identidade da ocorrencia
             de (assinatura, competencia) para (assinatura, DATA), e quatro
             cobrancas no mesmo mes passaram a caber. */
          if (!s.ativo) continue;
          if (s.fim && s.fim < iso(hoje)) continue;
          let d = new Date(s.inicio + "T00:00:00Z");
          let voltas = 0;
          /* semanal gasta 52 voltas por ano de atraso: o teto sobe junto */
          while (iso(d) < iso(hoje) && voltas++ < 5000) d = proxima(d, s.frequencia);
          while (iso(d) <= limite && (!s.fim || iso(d) <= s.fim)){
            const quando = iso(d);
            /* a idempotencia e do BANCO, e agora sobre a DATA: a mesma data nao
               entra duas vezes, e e isso que torna seguro chamar a cada carga */
            if (!T.transacoes.some(t => t.assinatura_id === s.id && t.ocorrencia_em === quando)){
              T.transacoes.push({ id:uid(), user_id:"u1", conta_id:s.conta_id || null,
                fatura_id:null, compra_id:null, parcela:null, total_parcelas:null,
                assinatura_id:s.id, competencia:quando.slice(0,7), ocorrencia_em:quando,
                categoria_id:s.categoria_id || null,
                tipo:"saida", natureza:"normal", descricao:s.nome, valor:s.valor,
                data:quando, status:"prevista", origem:"recorrencia", origem_id:s.id,
                obs:"", transferencia_id:null });
              criadas++;
            }
            d = proxima(d, s.frequencia);
          }
        }
        return Promise.resolve({ data:criadas, error:null });
      }

      /* --- cartão e fatura, mesma regra da 007 --- */
      const diasDoMes = (mes) => {
        const [a,m] = mes.split("-").map(Number);
        return new Date(Date.UTC(a, m, 0)).getUTCDate();
      };
      const diaNoMes = (mes, dia) =>
        mes + "-" + String(Math.min(Math.max(dia,1), diasDoMes(mes))).padStart(2,"0");
      const midx = (k) => { const p = k.split("-"); return (+p[0])*12 + (+p[1]) - 1; };
      const fromIdx = (i) => Math.floor(i/12) + "-" + String(i%12 + 1).padStart(2,"0");
      const competenciaDaCompra = (iso, fecha) => {
        const mes = iso.slice(0,7), dia = +iso.slice(8,10);
        return dia < +diaNoMes(mes, fecha).slice(8,10) ? mes : fromIdx(midx(mes)+1);
      };
      const cicloDaFatura = (comp, fecha, vence) => ({
        abertura: diaNoMes(fromIdx(midx(comp)-1), fecha),
        fechamento: diaNoMes(comp, fecha),
        vencimento: diaNoMes(vence > fecha ? comp : fromIdx(midx(comp)+1), vence),
      });
      /* encontra OU cria: chamar duas vezes devolve a mesma fatura */
      const faturaNaCompetencia = (cartaoId, comp) => {
        const c = T.cartoes.find(x => x.id === cartaoId);
        if (!c) return null;
        const achou = T.faturas.find(f => f.cartao_id === cartaoId && f.competencia === comp);
        if (achou) return achou.id;
        const ci = cicloDaFatura(comp, c.dia_fechamento, c.dia_vencimento);
        const nova = { id:uid(), user_id:"u1", cartao_id:cartaoId, competencia:comp,
                       abertura:ci.abertura, fechamento:ci.fechamento, vencimento:ci.vencimento };
        T.faturas.push(nova);
        return nova.id;
      };
      if (nome === "fatura_do_cartao"){
        const c = T.cartoes.find(x => x.id === a.p_cartao);
        if (!c) return Promise.resolve({ data:null, error:{ message:"fatura: cartão não encontrado" } });
        return Promise.resolve({ data: faturaNaCompetencia(a.p_cartao,
          competenciaDaCompra(a.p_data, c.dia_fechamento)), error:null });
      }
      if (nome === "registra_compra_de_cartao"){
        const c = T.cartoes.find(x => x.id === a.p_cartao);
        if (!c) return Promise.resolve({ data:null, error:{ message:"compra: cartão não encontrado" } });
        if (!(a.p_valor_total > 0))
          return Promise.resolve({ data:null, error:{ message:"compra: o valor precisa ser maior que zero" } });
        const n = a.p_parcelas || 1;
        const compra = { id:uid(), user_id:"u1", cartao_id:a.p_cartao, categoria_id:a.p_categoria||null,
                         descricao:a.p_descricao, valor_total:a.p_valor_total,
                         data_compra:a.p_data, total_parcelas:n, obs:a.p_obs||"" };
        T.compras_de_cartao.push(compra);
        const centavos = Math.round(a.p_valor_total * 100);
        const base = Math.floor(centavos / n), sobra = centavos - base * n;
        const comp1 = competenciaDaCompra(a.p_data, c.dia_fechamento);
        for (let i = 0; i < n; i++){
          const comp = fromIdx(midx(comp1) + i);
          T.transacoes.push({ id:uid(), user_id:"u1",
            /* compra no cartão NÃO tem conta: nada saiu de conta nenhuma */
            conta_id:null, fatura_id:faturaNaCompetencia(a.p_cartao, comp),
            compra_id:compra.id, parcela:i+1, total_parcelas:n,
            categoria_id:a.p_categoria||null, tipo:"saida", natureza:"normal",
            descricao:a.p_descricao, valor:(base + (i === 0 ? sobra : 0)) / 100,
            data:diaNoMes(comp, +a.p_data.slice(8,10)), status:"realizada",
            origem:"cartao", origem_id:compra.id, obs:a.p_obs||"", transferencia_id:null });
        }
        return Promise.resolve({ data:compra.id, error:null });
      }
      if (nome === "paga_fatura"){
        const f = T.faturas.find(x => x.id === a.p_fatura);
        if (!f) return Promise.resolve({ data:null, error:{ message:"fatura: não encontrada" } });
        if (!a.p_conta) return Promise.resolve({ data:null, error:{ message:"fatura: escolha a conta" } });
        if (!(a.p_valor > 0))
          return Promise.resolve({ data:null, error:{ message:"fatura: o valor precisa ser maior que zero" } });
        /* A 012 trocou a trava: não é mais "uma liquidação por fatura", e
           sim "a soma não passa do devido". Com a regra antiga aqui, o dublê
           recusaria o segundo pagamento e o teste concordaria com um produto
           que já não existe. */
        {
          const fr = faturasResolvidas().find(x => x.fatura_id === f.id);
          const devido = fr ? fr.total : 0;
          const pago = fr ? fr.pago : 0;
          if (devido <= 0)
            return Promise.resolve({ data:null, error:{ message:"fatura: não há nada a pagar nesta fatura" } });
          if (devido - pago <= 0)
            return Promise.resolve({ data:null, error:{ message:"fatura: esta fatura já está paga" } });
          if (a.p_valor > devido - pago)
            return Promise.resolve({ data:null, error:{ message:
              "fatura: falta " + (devido - pago).toFixed(2) + " e você lançou " + Number(a.p_valor).toFixed(2)
              + ". Pagamento acima do devido não é aceito." } });
        }
        const c = T.cartoes.find(x => x.id === f.cartao_id);
        const t = { id:uid(), user_id:"u1", conta_id:a.p_conta,
                    /* o pagamento NÃO é item da fatura: se fosse, entraria no total */
                    fatura_id:null, compra_id:null, parcela:null, total_parcelas:null,
                    categoria_id:null, tipo:"saida", natureza:"pagamento_de_fatura",
                    descricao:"Fatura " + ((c && c.nome) || "do cartão"),
                    valor:a.p_valor, data:a.p_data, status:"realizada",
                    origem:"cartao", origem_id:f.id, obs:a.p_obs||"", transferencia_id:null };
        T.transacoes.push(t);
        T.liquidacoes.push({ id:uid(), user_id:"u1", tipo:"fatura", item_id:f.id,
                             competencia:f.competencia, transacao_id:t.id, valor:a.p_valor });
        return Promise.resolve({ data:t.id, error:null });
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
      /* Estorno, com a MESMA regra da 010: so natureza normal, sinal invertido,
         categoria e origem herdadas, e a soma nunca passa do original. */
      /* So conta LIVRE entra, igual a 014. Se o duble somasse tudo, ele
         concordaria com uma tela que reserva dinheiro bloqueado. */
      if (nome === "saldo_livre_do_usuario"){
        const livre = saldos().filter(s => {
          const c = T.contas.find(x => x.id === s.conta_id);
          return !c || (c.liquidez || "livre") === "livre";
        }).reduce((s,x) => s + Number(x.saldo), 0);
        return Promise.resolve({ data: livre, error:null });
      }
      /* A REGRA MENSAL DA META, espelhando a 016. O duble reproduz os DOIS
         tetos e o limite do alvo, porque e exatamente isso que a tela nao
         pode decidir sozinha: se ele alocasse a regra inteira sempre, a tela
         concordaria com um banco que recusa. */
      /* o mes corrente, na mesma regua do app */
      const mesDeHoje = () => { const d = new Date();
        return d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0"); };
      const disponivelDeAgora = () => {
        const livre = saldos().filter(s => {
          const c = T.contas.find(x => x.id === s.conta_id);
          return !c || (c.liquidez || "livre") === "livre";
        }).reduce((s,x) => s + Number(x.saldo), 0);
        const reservado = T.alocacoes_de_meta.reduce((s,x) => s + Number(x.valor), 0);
        return Math.round((livre - reservado) * 100) / 100;
      };
      /* APLICAR UMA COMPETENCIA, espelhando a 017. O duble reproduz as recusas
         de VIGENCIA, de competencia FUTURA e de competencia ja DECIDIDA: sem
         elas a tela concordaria com um banco que recusa. */
      const aplicaUma = (metaId, comp) => {
        const m = T.metas.find(x => x.id === metaId);
        if (!m) return { erro:"meta: não encontrada" };
        if (!m.regra_ativa) return { erro:"meta: esta meta não tem regra mensal ligada" };
        if (m.status !== "ativa") return { erro:"meta: só meta ativa reserva por regra" };
        if (!m.regra_desde || comp < m.regra_desde) return { erro:"meta: a regra não valia em " + comp };
        if (comp > mesDeHoje()) return { erro:"meta: não dá para reservar uma competência futura" };
        if (T.competencias_de_regra.some(c => c.meta_id === metaId && c.competencia === comp))
          return { erro:"meta: a competência " + comp + " já foi decidida" };

        const jaAplicada = T.alocacoes_de_meta.some(x =>
          x.meta_id === metaId && x.competencia === comp && x.origem === "regra");
        const disponivel = disponivelDeAgora();
        if (jaAplicada) return { alocado:0, ja_aplicada:true, disponivel };
        if (!(disponivel > 0)) return { alocado:0, ja_aplicada:false, disponivel };
        const naMeta = T.alocacoes_de_meta.filter(x => x.meta_id === metaId)
                        .reduce((s,x) => s + Number(x.valor), 0);
        /* nem acima do disponivel, nem acima do que falta para o alvo */
        const quanto = Math.min(Number(m.regra_valor), disponivel,
                                Math.max(0, Number(m.valor_alvo) - naMeta));
        if (!(quanto > 0)) return { alocado:0, ja_aplicada:false, disponivel };
        T.alocacoes_de_meta.push({ id:uid(), user_id:"u1", meta_id:metaId,
          valor:quanto, data:comp + "-01", competencia:comp,
          origem:"regra", obs:"Regra mensal",
          /* o CONGELAMENTO: quanto a regra pedia neste instante */
          valor_planejado:Number(m.regra_valor),
          criado_em:new Date().toISOString() });
        return { alocado:quanto, ja_aplicada:false, disponivel };
      };
      /* a ordem determinIstica da 017: prioridade, prazo, criado_em, id */
      const ordemDasMetas = (a1, b1) => {
        const pa = Number(a1.prioridade ?? 2), pb = Number(b1.prioridade ?? 2);
        if (pa !== pb) return pa - pb;
        if (!a1.prazo && b1.prazo) return 1;
        if (a1.prazo && !b1.prazo) return -1;
        if (a1.prazo && b1.prazo){ const d = String(a1.prazo).localeCompare(String(b1.prazo));
          if (d) return d; }
        return String(a1.id).localeCompare(String(b1.id));
      };

      if (nome === "aplica_regra_de_meta"){
        const r = aplicaUma(a.p_meta, a.p_competencia);
        if (r.erro) return Promise.resolve({ data:null, error:{ message:r.erro } });
        return Promise.resolve({ data:[r], error:null });
      }
      /* A AUTOMACAO: so a competencia atual, nunca o passado. */
      if (nome === "aplica_regras_da_competencia"){
        const comp = a.p_competencia || mesDeHoje();
        if (comp !== mesDeHoje()) return Promise.resolve({ data:null,
          error:{ message:"meta: a automação só roda na competência atual" } });
        const alvos = T.metas.filter(m => m.regra_ativa && m.status === "ativa"
          && m.regra_desde && m.regra_desde <= comp
          && !T.alocacoes_de_meta.some(x => x.meta_id === m.id && x.competencia === comp && x.origem === "regra")
          && !T.competencias_de_regra.some(c => c.meta_id === m.id && c.competencia === comp))
          .slice().sort(ordemDasMetas);
        const fora = [];
        for (const m of alvos){
          const r = aplicaUma(m.id, comp);
          if (!r.erro) fora.push({ meta_id:m.id, alocado:r.alocado, ja_aplicada:r.ja_aplicada });
        }
        return Promise.resolve({ data:fora, error:null });
      }
      if (nome === "ignora_competencia_de_regra"){
        const m = T.metas.find(x => x.id === a.p_meta);
        if (!m) return Promise.resolve({ data:null, error:{ message:"meta: não encontrada" } });
        if (m.regra_valor == null) return Promise.resolve({ data:null,
          error:{ message:"meta: esta meta não tem regra mensal" } });
        if (!m.regra_desde || a.p_competencia < m.regra_desde) return Promise.resolve({ data:null,
          error:{ message:"meta: a regra não valia em " + a.p_competencia } });
        if (T.alocacoes_de_meta.some(x => x.meta_id === a.p_meta
              && x.competencia === a.p_competencia && x.origem === "regra"))
          return Promise.resolve({ data:null,
            error:{ message:"meta: a competência " + a.p_competencia + " já foi aplicada" } });
        if (!T.competencias_de_regra.some(c => c.meta_id === a.p_meta && c.competencia === a.p_competencia))
          T.competencias_de_regra.push({ id:uid(), user_id:"u1", meta_id:a.p_meta,
            competencia:a.p_competencia, situacao:"ignorada",
            valor_planejado:Number(m.regra_valor), decidida_em:new Date().toISOString() });
        return Promise.resolve({ data:true, error:null });
      }
      /* REGULARIZAR EM LOTE: sequencial, e o erro de uma nao derruba as outras */
      if (nome === "regulariza_competencias"){
        const itens = Array.isArray(a.p_itens) ? a.p_itens : [];
        const comMeta = itens.map(i => ({ ...i, m: T.metas.find(x => x.id === i.meta_id) }))
          .filter(i => i.m)
          .sort((x, y) => ordemDasMetas(x.m, y.m)
            || String(x.competencia).localeCompare(String(y.competencia)));
        const fora = [];
        for (const i of comMeta){
          const r = aplicaUma(i.meta_id, i.competencia);
          fora.push({ meta_id:i.meta_id, competencia:i.competencia,
            alocado:r.erro ? 0 : r.alocado, erro:r.erro || null });
        }
        return Promise.resolve({ data:fora, error:null });
      }
      /* Desfazer APAGA a linha da regra daquele mes, e so ela. As manuais
         ficam: elas nao vieram da regra. */
      if (nome === "desfaz_regra_de_meta"){
        const antes = T.alocacoes_de_meta.length + T.competencias_de_regra.length;
        T.alocacoes_de_meta = T.alocacoes_de_meta.filter(x => !(
          x.meta_id === a.p_meta && x.competencia === a.p_competencia && x.origem === "regra"));
        /* a decisao vai junto: desfazer devolve a competencia a PENDENTE, e
           deixa-la ignorada seria devolver a um estado que ninguem escolheu */
        T.competencias_de_regra = T.competencias_de_regra.filter(c => !(
          c.meta_id === a.p_meta && c.competencia === a.p_competencia));
        return Promise.resolve({ data:
          T.alocacoes_de_meta.length + T.competencias_de_regra.length < antes, error:null });
      }
      if (nome === "estorna_transacao"){
        const o = T.transacoes.find(x => x.id === a.p_transacao);
        if (!o) return Promise.resolve({ data:null, error:{ message:"estorno: transação não encontrada" } });
        if (o.natureza !== "normal")
          return Promise.resolve({ data:null, error:{ message:"estorno: só lançamento normal se estorna" } });
        const ja = T.transacoes.filter(x => x.natureza === "estorno" && x.estorno_de_id === o.id)
                    .reduce((s,x) => s + Number(x.valor), 0);
        const cabe = Number(o.valor) - ja;
        const v = a.p_valor == null ? cabe : Number(a.p_valor);
        if (!(v > 0))
          return Promise.resolve({ data:null, error:{ message:"estorno: o valor precisa ser maior que zero" } });
        if (v > cabe)
          return Promise.resolve({ data:null, error:{ message:
            "estorno: a soma passaria do original. Cabe " + cabe.toFixed(2) + "." } });
        const e = { id:uid(), user_id:"u1", conta_id:o.conta_id, fatura_id:o.fatura_id || null,
          compra_id:null, parcela:null, total_parcelas:null, assinatura_id:null,
          competencia:null, ocorrencia_em:null,
          categoria_id:o.categoria_id || null,
          /* o sinal INVERTE: e o que faz o dinheiro voltar do lado certo */
          tipo: o.tipo === "saida" ? "entrada" : "saida",
          natureza:"estorno", estorno_de_id:o.id,
          descricao:"Estorno · " + o.descricao, valor:v,
          data:a.p_data || o.data, status:"realizada",
          origem:o.origem, origem_id:o.origem_id || null, obs:a.p_obs||"",
          transferencia_id:null };
        T.transacoes.push(e);
        return Promise.resolve({ data:e.id, error:null });
      }

      /* Desfaz UM pagamento de fatura. Separado de desfaz_liquidacao porque
         aquela apaga a liquidação da competência inteira -- com três
         pagamentos, apagaria os três. */
      if (nome === "desfaz_pagamento_de_fatura"){
        const l = T.liquidacoes.find(x => x.tipo === "fatura" && x.transacao_id === a.p_pagamento);
        if (!l) return Promise.resolve({ data:null, error:{ message:"fatura: pagamento não encontrado" } });
        T.liquidacoes = T.liquidacoes.filter(x => x !== l);
        T.transacoes = T.transacoes.filter(t => t.id !== a.p_pagamento);
        return Promise.resolve({ data:true, error:null });
      }
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
      getUser:()=>Promise.resolve({ data:{ user:{ id:"u1", email:"teste@example.com", user_metadata:{} } }, error:null }),
      updateUser:(mudancas)=>Promise.resolve({ data:{ user:{ id:"u1", email:mudancas.email || "teste@example.com", user_metadata:mudancas.data || {} } }, error:null }),
      signInWithPassword:()=>Promise.resolve({ error:null }),
      signOut:()=>Promise.resolve({}) },
    storage:{ from:()=>({
      download:()=>Promise.resolve({data:null,error:{statusCode:404,message:"Object not found"}}),
      upload:()=>Promise.resolve({data:{path:"u1/avatar"},error:null}),
      remove:()=>Promise.resolve({data:[],error:null})
    }) } };
}

globalThis.__SB = createClient();`;

/* ------------------------------------------------------------ navegador --*/
const nav = chromium ? await chromium.launch({ executablePath: CHROMIUM }) : null;
export const fechaNavegador = async () => { await nav?.close(); servidor.close(); };

/* Abre o app numa aba nova, com o Supabase dublado e as fontes silenciadas.
   Devolve a página e o vetor de erros que ela produziu -- todo teste que abre
   o app deve conferir que esse vetor terminou vazio. */
export async function abreApp(largura){
  const p = await nav.newPage();
  const erros = [];
  p.on("pageerror", (e) => { erros.push(String(e).slice(0, 180));
    if (process.env.DEBUG_ERROS) console.error("PAGEERROR:", String(e).slice(0, 400)); });
  p.on("console", (m) => { if (m.type() === "error"){
    const t = m.text();
    /* a rede do contêiner não alcança CDN nem fonte; isso não é defeito do app */
    if (!/ERR_|Failed to load resource|net::/.test(t)) erros.push(t.slice(0, 180));
  } });
  await p.route("**/supabase-js@2*/+esm", (r) =>
    r.fulfill({ status:200, contentType:"text/javascript", body: DUBLE }));
  await p.route("**/fonts.googleapis.com/**", (r) =>
    r.fulfill({ status:200, contentType:"text/css", body:"" }));
  await p.setViewportSize({ width: largura, height: 900 });
  await p.goto(`http://127.0.0.1:${PORTA}/index.html`, { waitUntil:"networkidle" });
  await p.waitForTimeout(450);
  return { p, erros };
}

export const vaiPara = (p, aba) =>
  p.evaluate((a) => document.getElementById("nav-" + a).click(), aba);

/* O placar, para os arquivos de teste não reescreverem o mesmo `eq`. */
export function placar(){
  const estado = { ok:0, bad:0 };
  const eq = (nome, got, want) => {
    const a = JSON.stringify(got), b = JSON.stringify(want);
    if (a === b) estado.ok++;
    else { estado.bad++; console.error(`  ✗ ${nome}\n      esperado ${b}\n      obtido   ${a}`); }
  };
  const falha = (msg) => { estado.bad++; console.error("  ✗ " + msg); };
  return { estado, eq, falha };
}
