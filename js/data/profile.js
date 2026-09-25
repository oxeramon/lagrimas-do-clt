/* Perfil autenticado. Dados de apresentação ficam no Auth; foto, num bucket privado. */
import { conexao, erroLegivel } from "./client.js";

const FOTO_BUCKET = "profile-photos";
const caminhoFoto = (id) => `${id}/avatar`;

function resultado(operacao, contexto){
  return Promise.resolve(operacao).then(({data, error}) =>
    ({ dados: data || null, erro: error ? erroLegivel(error, contexto) : null }))
    .catch((erro) => ({ dados:null, erro:erroLegivel(erro, contexto) }));
}

export async function carregaPerfil(){
  return resultado(conexao.sb.auth.getUser(), "perfil");
}

export async function salvaPerfil(nome, telefone){
  return resultado(conexao.sb.auth.updateUser({ data: {
    display_name: nome,
    contact_phone: telefone,
  } }), "perfil");
}

export async function alteraEmail(email){
  return resultado(conexao.sb.auth.updateUser({ email }), "e-mail");
}

export async function alteraSenha(senhaAtual, novaSenha){
  try {
    const { data, error } = await conexao.sb.auth.updateUser({
      current_password: senhaAtual,
      password: novaSenha,
    });
    if (!error) return { dados:data || null, erro:null };
    const texto = String(error.message || "");
    if (/current password|password.*incorrect|invalid password/i.test(texto))
      return { dados:null, erro:"A senha atual não confere." };
    if (/weak password|password.*strength|password.*characters/i.test(texto))
      return { dados:null, erro:"A nova senha não atende aos requisitos de segurança." };
    return { dados:null, erro:erroLegivel(error, "senha") };
  } catch (erro){ return { dados:null, erro:erroLegivel(erro, "senha") }; }
}

export async function baixaFoto(id){
  try {
    const { data, error } = await conexao.sb.storage.from(FOTO_BUCKET).download(caminhoFoto(id));
    if (!error) return { dados:data, erro:null };
    if (String(error.statusCode || error.status || "") === "404" || /not found|object not found/i.test(error.message || ""))
      return { dados:null, erro:null };
    return { dados:null, erro:erroLegivel(error, "foto") };
  } catch (erro){ return { dados:null, erro:erroLegivel(erro, "foto") }; }
}

export async function enviaFoto(id, arquivo){
  return resultado(conexao.sb.storage.from(FOTO_BUCKET).upload(caminhoFoto(id), arquivo, {
    contentType: arquivo.type,
    upsert: true,
    cacheControl: "0",
  }), "foto");
}

export async function apagaFoto(id){
  return resultado(conexao.sb.storage.from(FOTO_BUCKET).remove([caminhoFoto(id)]), "foto");
}

