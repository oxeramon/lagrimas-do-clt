# A fronteira da publicação

O que sai do repositório e vai parar num servidor web, e o que fica só no
repositório. Duas coisas diferentes que até 13/09/2026 eram a mesma.

## O que mudou

Antes, o GitHub Pages estava em **Deploy from a branch**: ele pegava a árvore
inteira de `main` e servia tudo. `https://oxeramon.github.io/lagrimas-do-clt/CLAUDE.md`
abria. `docs/`, `supabase/migrations/`, `testes/`, `.claude/`, os hooks: tudo no
ar, tudo indexável.

Agora o Pages publica um **artefato** construído por
`ferramentas/artefato.mjs`: 29 arquivos, `index.html` mais `css/*.css` mais
`js/**/*.js`. Nada mais.

| | repositório | artefato |
|---|---|---|
| o que é | a fonte interna do projeto | o frontend mínimo |
| quem lê | quem clona, quem revisa | o navegador de quem abre o site |
| contém | docs, migrações, testes, hooks, ferramentas | HTML, CSS e JS, só |
| hoje | 200+ arquivos | 29 arquivos, 466 KiB |

## Por que whitelist, e não lista de exclusão

`cp -r . _site` seguido de uma lista de `rm` é o desenho errado, e o motivo é o
tempo: o arquivo interno que alguém criar daqui a seis meses entra no ar
sozinho, porque ninguém vai lembrar de acrescentá-lo à lista de exclusão. **A
falha da exclusão é silenciosa e o padrão dela é publicar.**

Com whitelist é o contrário. O que não foi explicitamente permitido fica de
fora, e a falha, se houver, é um arquivo faltando, que aparece na hora como 404
no teste de dependência e como fluxo quebrado em `testes/fluxos.mjs`.

## A lista não é a única guarda

Permitir a pasta `js/` inteira ainda deixaria passar um `js/rascunho.js` que
ninguém importa. Por isso `testes/artefato.mjs` confere, além da lista, que o
conjunto publicado é **exatamente** o grafo de dependência a partir do
`index.html`: nem sobra, nem falta.

É essa igualdade que torna a whitelist verificável em vez de confiável.

## O que continua público, de propósito

Não é descuido, é como aplicação web funciona:

- o HTML, o CSS e o JavaScript que o navegador executa;
- a URL do Supabase;
- a **chave publicável** (`sb_publishable_...`);
- os nomes das RPCs que o navegador chama.

Tudo isso o navegador precisa ter para o site existir. Esconder qualquer um
deles seria falsa segurança: o valor continuaria no pacote, só mais difícil de
ler.

**Quem protege o dado é Auth + RLS + grant + ownership**, e nada mais. Uma
chave publicável sem sessão não lê linha nenhuma, porque toda policy exige
`auth.uid()`. Esta rodada não mexeu em nada disso, e nada disso depende do que
está publicado.

O que `testes/artefato.mjs` barra é o contrário: chave de serviço do Supabase,
papel privilegiado do Postgres, JWT legado, DDL, corpo de função de banco e
segredo declarado. Os prefixos exatos estão no próprio teste, montados por
concatenação — escritos inteiros aqui, a auditoria do repositório acusaria esta
página como se ela fosse o vazamento que descreve.

## Fechar o repositório NÃO fecha o site

Vale deixar escrito porque é a confusão mais fácil de cometer:

- tornar o repositório **privado** esconde a fonte, e nada mais;
- o site continua público, porque GitHub Pages serve para a internet inteira;
- quem abrir o site continua baixando o mesmo HTML, o mesmo JS e a mesma chave
  publicável.

Se um dia o site precisar ser privado, isso não se resolve no Pages. Resolve-se
com outra hospedagem, com autenticação na frente. A proteção do **dado**, essa
já não depende disso: depende de RLS.

## Como rodar

```bash
node ferramentas/artefato.mjs        # constrói _site/ (fora do git)
node testes/artefato.mjs             # 92 conferências sobre o artefato
SERVIR_ARTEFATO=1 node testes/fluxos.mjs   # os 204 fluxos contra o artefato
```

O artefato é construído **do zero** a cada execução. Reaproveitar um `_site`
anterior traria de volta justamente o arquivo que acabou de sair da whitelist,
e ninguém repararia.

## O deploy

`.github/workflows/deploy-pages.yml`, com as actions oficiais
(`configure-pages`, `upload-pages-artifact`, `deploy-pages`). Permissões no
mínimo: `contents: read`, `pages: write`, `id-token: write`. Sem
`contents: write` — o workflow não escreve no repositório.

A ordem é a parte que importa: **construir, conferir, e só então subir**. Um
teste que roda depois do deploy não impede nada, só narra.

> **Passo manual, uma vez.** O workflow só tem efeito com
> Settings → Pages → Build and deployment → **Source = GitHub Actions**.
> Enquanto a origem for "Deploy from a branch", o Pages continua publicando a
> árvore inteira e este workflow roda à toa.

## Como voltar atrás

Em Settings → Pages, trocar Source de volta para **Deploy from a branch**
(`main`, `/`). O Pages volta a publicar a árvore inteira na hora seguinte.
Nenhum arquivo do site foi alterado nesta rodada — os 29 arquivos do artefato
são cópia byte a byte do repositório, e o teste confere isso —, então voltar
não exige reverter commit nenhum.

Commit anterior à rodada: `1be094e`.
