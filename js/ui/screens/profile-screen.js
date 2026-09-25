import { $ } from "../../core/dom.js";
import { quandoTrocarDeAba, vaiParaAba } from "../navigation.js";
import { carregaPerfil, salvaPerfil, alteraEmail, alteraSenha, baixaFoto, enviaFoto, apagaFoto } from "../../data/profile.js";
import { observaSessao } from "../../data/session.js";

let usuario = null;
let urlFoto = null;
let carga = 0;

function mensagem(id, texto, falha = false){
  const el = $(id);
  el.textContent = texto;
  el.classList.toggle("erro", falha);
}

function trocaImagem(blob){
  if (urlFoto) URL.revokeObjectURL(urlFoto);
  urlFoto = blob ? URL.createObjectURL(blob) : null;
  $("perfilImagem").hidden = !urlFoto;
  $("perfilImagem").removeAttribute("src");
  if (urlFoto) $("perfilImagem").src = urlFoto;
  $("perfilIniciais").hidden = !!urlFoto;
  $("perfilRemoverFoto").hidden = !urlFoto;
  for (const imagem of document.querySelectorAll("[data-perfil-imagem]")){
    imagem.hidden = !urlFoto;
    imagem.removeAttribute("src");
    if (urlFoto) imagem.src = urlFoto;
  }
  for (const iniciais of document.querySelectorAll("[data-perfil-iniciais]"))
    iniciais.hidden = !!urlFoto;
}

function mostraUsuario(user){
  usuario = user;
  const nome = String(user.user_metadata?.display_name || user.user_metadata?.full_name || "").trim();
  $("perfilNome").value = nome;
  $("perfilTelefone").value = String(user.user_metadata?.contact_phone || "");
  $("perfilEmail").value = user.email || "";
  $("perfilNomeExibido").textContent = nome || "Seu perfil";
  $("perfilEmailExibido").textContent = user.email || "";
  $("perfilIniciais").textContent = (nome || user.email || "U").trim().charAt(0).toLocaleUpperCase("pt-BR");
  const nomeCurto = nome || String(user.email || "Usuário").split("@")[0] || "Usuário";
  const inicial = nomeCurto.trim().charAt(0).toLocaleUpperCase("pt-BR") || "U";
  for (const alvo of document.querySelectorAll("[data-perfil-nome]")) alvo.textContent = nomeCurto;
  for (const alvo of document.querySelectorAll("[data-perfil-iniciais]")) alvo.textContent = inicial;
}

async function recarregaPerfil(){
  const atual = ++carga;
  mensagem("perfilDadosMensagem", "");
  mensagem("perfilEmailMensagem", "");
  const { dados, erro } = await carregaPerfil();
  if (atual !== carga) return;
  if (erro || !dados?.user){
    mensagem("perfilDadosMensagem", erro || "Não foi possível carregar seu perfil.", true);
    return;
  }
  mostraUsuario(dados.user);
  const foto = await baixaFoto(dados.user.id);
  if (atual !== carga) return;
  if (foto.dados instanceof Blob) trocaImagem(foto.dados);
  else trocaImagem(null);
  // A ausência de foto é um estado normal; erros de permissão/rede merecem aviso.
  if (foto.erro)
    mensagem("perfilFotoMensagem", "A foto não pôde ser carregada.", true);
}

async function validaImagem(arquivo){
  if (!["image/jpeg", "image/png", "image/webp"].includes(arquivo.type))
    return "Escolha uma imagem JPG, PNG ou WebP.";
  if (arquivo.size > 2 * 1024 * 1024) return "A foto deve ter até 2 MB.";
  try {
    const imagem = await createImageBitmap(arquivo);
    imagem.close();
    return null;
  } catch { return "Esse arquivo não parece ser uma imagem válida."; }
}

export function ligaPerfil(){
  $("perfilResumoLateral")?.addEventListener("click", () => vaiParaAba("perfil"));
  $("perfilResumoMovel")?.addEventListener("click", () => vaiParaAba("perfil"));
  observaSessao((uid) => { if (uid) recarregaPerfil(); });
  quandoTrocarDeAba((destino) => {
    if (destino === "perfil") recarregaPerfil();
    else { carga++; trocaImagem(null); }
  });

  $("perfilDadosForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!usuario) return;
    const nome = $("perfilNome").value.trim();
    const telefone = $("perfilTelefone").value.trim();
    if (!nome){ mensagem("perfilDadosMensagem", "Informe seu nome.", true); return; }
    const botao = $("perfilSalvarDados");
    botao.disabled = true;
    mensagem("perfilDadosMensagem", "Salvando…");
    const { dados, erro } = await salvaPerfil(nome, telefone);
    botao.disabled = false;
    if (erro) mensagem("perfilDadosMensagem", erro, true);
    else { mostraUsuario(dados.user); mensagem("perfilDadosMensagem", "Dados salvos."); }
  });

  $("perfilEmailForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!usuario) return;
    const email = $("perfilEmail").value.trim();
    if (email.toLowerCase() === String(usuario.email || "").toLowerCase()){
      mensagem("perfilEmailMensagem", "Este já é seu e-mail de acesso."); return;
    }
    const botao = $("perfilSalvarEmail");
    botao.disabled = true;
    mensagem("perfilEmailMensagem", "Solicitando alteração…");
    const { erro } = await alteraEmail(email);
    botao.disabled = false;
    mensagem("perfilEmailMensagem", erro || "Confira sua caixa de entrada para confirmar a alteração. Até lá, seu e-mail atual continua válido.", !!erro);
  });

  $("perfilSenhaForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!usuario) return;
    const atual = $("perfilSenhaAtual").value;
    const nova = $("perfilNovaSenha").value;
    const confirma = $("perfilConfirmaSenha").value;
    if (nova.length < 8){ mensagem("perfilSenhaMensagem", "A nova senha precisa ter pelo menos 8 caracteres.", true); return; }
    if (nova !== confirma){ mensagem("perfilSenhaMensagem", "As novas senhas não conferem.", true); return; }
    if (atual === nova){ mensagem("perfilSenhaMensagem", "Escolha uma senha diferente da atual.", true); return; }
    const botao = $("perfilSalvarSenha");
    botao.disabled = true;
    mensagem("perfilSenhaMensagem", "Alterando senha…");
    const { erro } = await alteraSenha(atual, nova);
    botao.disabled = false;
    if (erro) mensagem("perfilSenhaMensagem", erro, true);
    else {
      $("perfilSenhaForm").reset();
      mensagem("perfilSenhaMensagem", "Senha alterada.");
    }
  });

  $("perfilArquivo").addEventListener("change", async (e) => {
    const arquivo = e.target.files?.[0];
    e.target.value = "";
    if (!arquivo || !usuario) return;
    const invalidade = await validaImagem(arquivo);
    if (invalidade){ mensagem("perfilFotoMensagem", invalidade, true); return; }
    $("perfilArquivo").disabled = true;
    mensagem("perfilFotoMensagem", "Enviando foto…");
    const { erro } = await enviaFoto(usuario.id, arquivo);
    $("perfilArquivo").disabled = false;
    if (erro){ mensagem("perfilFotoMensagem", erro, true); return; }
    trocaImagem(arquivo);
    mensagem("perfilFotoMensagem", "Foto atualizada.");
  });

  $("perfilRemoverFoto").addEventListener("click", async () => {
    if (!usuario) return;
    const botao = $("perfilRemoverFoto");
    botao.disabled = true;
    mensagem("perfilFotoMensagem", "Removendo foto…");
    const { erro } = await apagaFoto(usuario.id);
    botao.disabled = false;
    if (erro) mensagem("perfilFotoMensagem", erro, true);
    else { trocaImagem(null); mensagem("perfilFotoMensagem", "Foto removida."); }
  });
}

