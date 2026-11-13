// Edge Function cadastro (sem login): GET mostra a política e a idade mínima; POST cria a conta do cliente.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { tratar, respostaJson, ErroHttp } from '../_shared/http.mjs';
import { admin } from '../_shared/contexto.js';
import { validarCadastro, dataNoFuso } from '../_shared/cadastro.mjs';

// Cliente com a chave pública: o signUp por ele envia o e-mail de confirmação, como no navegador.
const publico = createClient(
    Deno.env.get('SUPABASE_URL'),
    Deno.env.get('SUPABASE_ANON_KEY'),
    { auth: { persistSession: false, autoRefreshToken: false } },
);

const CAMPOS_DESTACADOS = 'Revise os campos destacados.';
const CPF_JA_USADO = 'Este CPF já tem conta. Entre com o seu e-mail ou recupere a senha.';

function conflito(campo, mensagem) {
    return respostaJson(409, { erro: CAMPOS_DESTACADOS, campos: { [campo]: mensagem } });
}

async function lerConfiguracoes() {
    const { data, error } = await admin.from('configuracoes').select('chave, valor').in('chave', ['cadastro', 'privacidade', 'estande']);
    if (error) throw error;
    return Object.fromEntries(data.map(linha => [linha.chave, linha.valor]));
}

function mostrar(config) {
    return respostaJson(200, {
        estande: { nome: config.estande.nome, fuso: config.estande.fuso },
        idade_minima: config.cadastro.idade_minima,
        politica: { versao: config.privacidade.versao, texto: config.privacidade.texto },
    });
}

async function criarConta(req, config) {
    let corpo;
    try {
        corpo = await req.json();
    } catch {
        throw new ErroHttp(400, 'Não foi possível ler os dados enviados. Tente de novo.');
    }

    const { campos, conta, perfil } = validarCadastro(corpo, {
        idadeMinima: config.cadastro.idade_minima,
        hoje: dataNoFuso(new Date(), config.estande.fuso),
        versaoPolitica: config.privacidade.versao,
    });
    if (Object.keys(campos).length > 0) return respostaJson(400, { erro: CAMPOS_DESTACADOS, campos });

    const jaTem = await admin.from('perfis').select('id').eq('cpf', perfil.cpf).maybeSingle();
    if (jaTem.error) throw jaTem.error;
    if (jaTem.data) return conflito('cpf', CPF_JA_USADO);

    const { data, error } = await publico.auth.signUp({ email: conta.email, password: conta.senha });
    if (error?.code === 'weak_password') {
        return respostaJson(400, { erro: CAMPOS_DESTACADOS, campos: { senha: 'Escolha uma senha mais forte, com pelo menos 8 caracteres.' } });
    }
    if (error?.code === 'over_email_send_rate_limit' || error?.code === 'over_request_rate_limit') {
        throw new ErroHttp(429, 'Muitos cadastros em pouco tempo. Espere alguns minutos e tente de novo.');
    }
    if (error) throw error;
    // Com a confirmação de e-mail ligada, um e-mail já confirmado volta como usuário sem identidades.
    if (!data.user.identities?.length) return conflito('email', 'Este e-mail já tem conta. Entre ou recupere a senha.');

    const usuarioId = data.user.id;
    const gravado = await admin.rpc('criar_perfil', {
        p_usuario: usuarioId,
        p_dados: { ...perfil, politica_versao: config.privacidade.versao, politica_aceita_em: new Date().toISOString() },
    });
    if (gravado.error) {
        // E-mail ainda não confirmado que já tem cadastro: a conta é de outra tentativa e não pode ser apagada.
        const perfilExistente = await admin.from('perfis').select('id').eq('id', usuarioId).maybeSingle();
        if (perfilExistente.error) throw perfilExistente.error;
        if (perfilExistente.data) return conflito('email', 'Este e-mail já tem conta. Procure o link de confirmação no seu e-mail.');

        // Login novo sem cadastro: apaga para não sobrar conta pela metade.
        const apagado = await admin.auth.admin.deleteUser(usuarioId);
        if (apagado.error) console.error(apagado.error);
        if (gravado.error.code === '23505') return conflito('cpf', CPF_JA_USADO);
        throw gravado.error;
    }

    return respostaJson(201, {
        mensagem: `Conta criada. Enviamos um link de confirmação para ${conta.email}. Abra o e-mail para ativar a conta.`,
    });
}

Deno.serve(tratar(async (req) => {
    if (req.method !== 'GET' && req.method !== 'POST') throw new ErroHttp(405, 'Esta ação não é permitida aqui.');
    const config = await lerConfiguracoes();
    if (req.method === 'GET') return mostrar(config);
    return criarConta(req, config);
}));
