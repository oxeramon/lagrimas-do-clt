/* Catálogo público de instituições.
 *
 * O que é: uma lista de marcas conhecidas no Brasil, para o cadastro não
 * começar num campo de texto vazio. É informação PÚBLICA -- nome e cor de
 * marca --, e foi escrita de cabeça, não extraída de base nenhuma. Que
 * instituições a pessoa usa é dado dela, e não mora aqui.
 *
 * ---------------------------------------------------------------------
 * POR QUE NÃO TEM URL DE LOGO
 * ---------------------------------------------------------------------
 * A tentação é apontar para o logo hospedado em algum CDN. Três problemas, e
 * nenhum deles aparece no dia em que se escreve o código:
 *
 *   1. o endereço muda, e aí a tela fica com um quadrado quebrado;
 *   2. o CDN pode cair, ficar lento ou bloquear hotlink;
 *   3. cada logo carregado conta para quem hospeda que você abriu o app.
 *
 * O desenho aqui é o contrário: o padrão é o MONOGRAMA, a inicial sobre a cor
 * da marca. Não depende de rede, fica pronto na primeira pintura, e a cor já
 * dá o reconhecimento que o logo daria. Quem quiser o logo de verdade cola uma
 * URL no cadastro da instituição, e aí `instituicoes.logo` manda -- com
 * `onerror` caindo de volta para o monograma se o endereço falhar.
 */

export const CATALOGO_INSTITUICOES = [
  { slug: "nubank",        nome: "Nubank",        tipo: "Fintech",   cor: "#820AD1" },
  { slug: "itau",          nome: "Itaú",          tipo: "Banco",     cor: "#EC7000" },
  { slug: "bradesco",      nome: "Bradesco",      tipo: "Banco",     cor: "#CC092F" },
  { slug: "santander",     nome: "Santander",     tipo: "Banco",     cor: "#EC0000" },
  { slug: "caixa",         nome: "Caixa",         tipo: "Banco",     cor: "#0070AF" },
  { slug: "banco-do-brasil", nome: "Banco do Brasil", tipo: "Banco", cor: "#0038A8" },
  { slug: "inter",         nome: "Banco Inter",   tipo: "Banco",     cor: "#FF7A00" },
  { slug: "c6",            nome: "C6 Bank",       tipo: "Banco",     cor: "#242424" },
  { slug: "btg",           nome: "BTG Pactual",   tipo: "Banco",     cor: "#0B2C3D" },
  { slug: "xp",            nome: "XP",            tipo: "Corretora", cor: "#111111" },
  { slug: "mercado-pago",  nome: "Mercado Pago",  tipo: "Fintech",   cor: "#00B1EA" },
  { slug: "picpay",        nome: "PicPay",        tipo: "Fintech",   cor: "#21C25E" },
  { slug: "carteira",      nome: "Dinheiro em espécie", tipo: "Carteira",   cor: "#6B7A76" },
  { slug: "empregador",    nome: "Empregador",    tipo: "Empregador", cor: "#1F5E52" },
];

/* A inicial que vira monograma. Duas letras quando o nome tem duas palavras
   que valem ("Banco do Brasil" vira BB, não BD), uma quando não tem. */
export function monogramaDe(nome){
  const menores = new Set(["de", "do", "da", "dos", "das", "e"]);
  const palavras = String(nome || "").trim().split(/\s+/).filter((p) => p && !menores.has(p.toLowerCase()));
  if (!palavras.length) return "?";
  if (palavras.length === 1) return palavras[0].slice(0, 1).toUpperCase();
  return (palavras[0][0] + palavras[1][0]).toUpperCase();
}

/* Branco ou escuro por cima da cor da marca?
 *
 * Fórmula de luminância relativa do WCAG. Chutar "branco sempre" quebra em
 * marca clara -- amarelo com texto branco não se lê --, e é o tipo de defeito
 * que só aparece na instituição que ninguém testou. */
export function contrasteSobre(hex){
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ""));
  if (!m) return "#FFFFFF";
  const n = parseInt(m[1], 16);
  const canal = (c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const L = 0.2126 * canal((n >> 16) & 255) + 0.7152 * canal((n >> 8) & 255) + 0.0722 * canal(n & 255);
  /* 0.45 e não 0.5: o olho perde o texto branco antes do meio da escala */
  return L > 0.45 ? "#14201C" : "#FFFFFF";
}

export const doCatalogo = (slug) => CATALOGO_INSTITUICOES.find((i) => i.slug === slug) || null;
