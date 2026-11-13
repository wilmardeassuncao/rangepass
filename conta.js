// Página da conta: liga as telas ao Supabase Auth (entrar, sair, senha) e às Edge Functions (cadastro e perfil).
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { SUPABASE_URL, SUPABASE_CHAVE_PUBLICA } from './config.js';
import { mensagemDoErroDeLogin, formatarCpf, formatarTelefone } from './conta-regras.mjs';
import { validarCadastro, validarEdicaoPerfil, dataNoFuso } from './supabase/functions/_shared/cadastro.mjs';

// Lido antes de o Supabase limpar o endereço: diz se a pessoa chegou pelo link de nova senha ou por um link vencido.
const parametrosDoLink = new URLSearchParams(location.hash.slice(1));
const veioDaRecuperacao = parametrosDoLink.get('type') === 'recovery';
const erroDoLink = parametrosDoLink.get('error_code');

const supabase = createClient(SUPABASE_URL, SUPABASE_CHAVE_PUBLICA);
const ERRO_PADRAO = 'Não foi possível concluir agora. Tente de novo em instantes.';
const CONTA_DESATIVADA = 'Sua conta está desativada. Procure o atendimento do estande.';

let dadosDoCadastro = null; // resposta do GET cadastro: política, idade mínima, fuso
let perfilAtual = null;

// ---------- Ajudantes de tela ----------

function mostrarTela(id) {
    for (const tela of document.querySelectorAll('.tela')) tela.classList.toggle('ativa', tela.id === id);
    window.scrollTo(0, 0);
}

function avisar(texto, tipo = 'erro') {
    const aviso = document.getElementById('aviso');
    aviso.textContent = texto ?? '';
    aviso.hidden = !texto;
    aviso.classList.toggle('sucesso', tipo === 'sucesso');
}

function limparErros(form) {
    for (const el of form.querySelectorAll('[data-erro-para]')) el.textContent = '';
    for (const el of form.querySelectorAll('[aria-invalid]')) el.removeAttribute('aria-invalid');
    const geral = form.querySelector('[data-erro-geral]');
    geral.textContent = '';
    geral.hidden = true;
}

function mostrarErros(form, campos) {
    for (const [campo, mensagem] of Object.entries(campos)) {
        const lugar = form.querySelector(`[data-erro-para="${campo}"]`);
        if (lugar) lugar.textContent = mensagem;
        else mostrarErroGeral(form, mensagem);
        form.elements[campo]?.setAttribute('aria-invalid', 'true');
    }
    form.querySelector('[aria-invalid="true"]')?.focus();
}

function mostrarErroGeral(form, mensagem) {
    const geral = form.querySelector('[data-erro-geral]');
    geral.textContent = mensagem;
    geral.hidden = false;
}

// Desabilita os botões do formulário enquanto a chamada está em andamento.
async function ocupado(form, acao) {
    const botoes = form.querySelectorAll('button');
    botoes.forEach(b => { b.disabled = true; });
    try {
        await acao();
    } catch (erro) {
        console.error(erro);
        mostrarErroGeral(form, ERRO_PADRAO);
    } finally {
        botoes.forEach(b => { b.disabled = false; });
    }
}

function valoresDe(form) {
    return Object.fromEntries(new FormData(form).entries());
}

function formatarData(data) {
    const [ano, mes, dia] = (data ?? '').split('-');
    return dia ? `${dia}/${mes}/${ano}` : '';
}

// ---------- Conversa com as Edge Functions ----------

async function chamarFuncao(nome, { metodo = 'GET', corpo } = {}) {
    const { data: { session } } = await supabase.auth.getSession();
    const cabecalhos = { apikey: SUPABASE_CHAVE_PUBLICA };
    if (session) cabecalhos.Authorization = `Bearer ${session.access_token}`;
    if (corpo !== undefined) cabecalhos['Content-Type'] = 'application/json';
    const resposta = await fetch(`${SUPABASE_URL}/functions/v1/${nome}`, {
        method: metodo, headers: cabecalhos, body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
    let dados = null;
    try { dados = await resposta.json(); } catch { dados = null; }
    return { status: resposta.status, dados };
}

// ---------- Meu perfil ----------

async function abrirPerfil() {
    const r = await chamarFuncao('minha-conta');
    if (r.status === 403 || r.status === 401) {
        await supabase.auth.signOut();
        avisar(r.dados?.erro ?? CONTA_DESATIVADA);
        mostrarTela('tela-entrar');
        return;
    }
    if (r.status !== 200) {
        avisar(r.dados?.erro ?? ERRO_PADRAO);
        mostrarTela('tela-entrar');
        return;
    }
    if (!r.dados.perfil) {
        avisar('Não encontramos o seu cadastro. Procure o atendimento do estande.');
        await supabase.auth.signOut();
        mostrarTela('tela-entrar');
        return;
    }
    perfilAtual = r.dados.perfil;
    mostrarPerfil(r.dados.email, perfilAtual);
    mostrarTela('tela-perfil');
}

function mostrarPerfil(email, perfil) {
    document.getElementById('perfil-email').textContent = `${perfil.nome_completo} · ${email}`;
    document.getElementById('perfil-cpf').textContent = formatarCpf(perfil.cpf);
    document.getElementById('perfil-nascimento').textContent = formatarData(perfil.data_nascimento);
    document.getElementById('perfil-telefone').textContent = formatarTelefone(perfil.telefone);
    const form = document.getElementById('form-perfil');
    for (const campo of ['nome_completo', 'cr', 'orgao_expedidor']) form.elements[campo].value = perfil[campo] ?? '';
    form.elements.telefone.value = formatarTelefone(perfil.telefone);
}

document.getElementById('form-perfil').addEventListener('submit', (evento) => {
    evento.preventDefault();
    const form = evento.currentTarget;
    limparErros(form);
    avisar(null);
    const dados = valoresDe(form);
    const { campos } = validarEdicaoPerfil(dados);
    if (Object.keys(campos).length) return mostrarErros(form, campos);

    ocupado(form, async () => {
        const r = await chamarFuncao('minha-conta', { metodo: 'PUT', corpo: dados });
        if (r.status === 200) {
            perfilAtual = r.dados.perfil;
            const { data: { session } } = await supabase.auth.getSession();
            mostrarPerfil(session?.user?.email ?? '', perfilAtual);
            avisar('Dados salvos.', 'sucesso');
        } else if (r.dados?.campos) {
            mostrarErros(form, r.dados.campos);
        } else {
            mostrarErroGeral(form, r.dados?.erro ?? ERRO_PADRAO);
        }
    });
});

document.getElementById('botao-sair').addEventListener('click', async () => {
    await supabase.auth.signOut();
    perfilAtual = null;
    avisar(null);
    mostrarTela('tela-entrar');
});

// ---------- Entrar ----------

document.getElementById('form-entrar').addEventListener('submit', (evento) => {
    evento.preventDefault();
    const form = evento.currentTarget;
    limparErros(form);
    avisar(null);
    const { email, senha } = valoresDe(form);
    ocupado(form, async () => {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: senha });
        if (error) return mostrarErroGeral(form, mensagemDoErroDeLogin(error));
        form.reset();
        await abrirPerfil();
    });
});

// ---------- Criar conta ----------

async function abrirCriarConta() {
    mostrarTela('tela-criar');
    if (dadosDoCadastro) return;
    const form = document.getElementById('form-criar');
    const r = await chamarFuncao('cadastro');
    if (r.status !== 200) return mostrarErroGeral(form, r.dados?.erro ?? ERRO_PADRAO);
    dadosDoCadastro = r.dados;
    document.getElementById('texto-politica').textContent = dadosDoCadastro.politica.texto;
}

document.getElementById('form-criar').addEventListener('submit', (evento) => {
    evento.preventDefault();
    const form = evento.currentTarget;
    limparErros(form);
    avisar(null);
    if (!dadosDoCadastro) return mostrarErroGeral(form, ERRO_PADRAO);

    const { aceite, ...resto } = valoresDe(form);
    const dados = { ...resto, aceite_politica_versao: aceite ? dadosDoCadastro.politica.versao : 0 };
    const { campos } = validarCadastro(dados, {
        idadeMinima: dadosDoCadastro.idade_minima,
        hoje: dataNoFuso(new Date(), dadosDoCadastro.estande.fuso),
        versaoPolitica: dadosDoCadastro.politica.versao,
    });
    if (Object.keys(campos).length) return mostrarErros(form, campos);

    ocupado(form, async () => {
        const r = await chamarFuncao('cadastro', { metodo: 'POST', corpo: dados });
        if (r.status === 201) {
            form.reset();
            document.getElementById('mensagem-enviado').textContent = r.dados.mensagem;
            mostrarTela('tela-enviado');
        } else if (r.dados?.campos) {
            mostrarErros(form, r.dados.campos);
        } else {
            mostrarErroGeral(form, r.dados?.erro ?? ERRO_PADRAO);
        }
    });
});

// ---------- Esqueci a senha e nova senha ----------

document.getElementById('form-esqueci').addEventListener('submit', (evento) => {
    evento.preventDefault();
    const form = evento.currentTarget;
    limparErros(form);
    const { email } = valoresDe(form);
    if (!email.trim()) return mostrarErroGeral(form, 'Informe o seu e-mail.');
    ocupado(form, async () => {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${location.origin}/conta.html` });
        if (error && error.code?.startsWith('over_')) return mostrarErroGeral(form, mensagemDoErroDeLogin(error));
        // Mesma resposta exista ou não a conta, para não revelar quem tem cadastro.
        form.reset();
        avisar('Se este e-mail tiver conta, enviamos um link para criar uma nova senha.', 'sucesso');
        mostrarTela('tela-entrar');
    });
});

document.getElementById('form-nova-senha').addEventListener('submit', (evento) => {
    evento.preventDefault();
    const form = evento.currentTarget;
    limparErros(form);
    const { senha } = valoresDe(form);
    if (!senha) return mostrarErroGeral(form, 'Crie uma senha.');
    ocupado(form, async () => {
        const { error } = await supabase.auth.updateUser({ password: senha });
        if (error) return mostrarErroGeral(form, mensagemDoErroDeLogin(error));
        form.reset();
        avisar('Senha alterada.', 'sucesso');
        await abrirPerfil();
    });
});

// ---------- Navegação e início ----------

for (const botao of document.querySelectorAll('[data-ir]')) {
    botao.addEventListener('click', () => {
        avisar(null);
        if (botao.dataset.ir === 'tela-criar') abrirCriarConta();
        else mostrarTela(botao.dataset.ir);
    });
}

supabase.auth.onAuthStateChange((evento) => {
    if (evento === 'PASSWORD_RECOVERY') mostrarTela('tela-nova-senha');
});

async function iniciar() {
    if (erroDoLink) {
        history.replaceState(null, '', location.pathname);
        avisar('Este link venceu ou já foi usado. Entre com a sua senha ou peça um link novo em "Esqueci a senha".');
    }
    const { data: { session } } = await supabase.auth.getSession();
    if (veioDaRecuperacao && session) return mostrarTela('tela-nova-senha');
    if (session) return abrirPerfil();
    mostrarTela('tela-entrar');
}

iniciar().catch((erro) => {
    console.error(erro);
    avisar(ERRO_PADRAO);
    mostrarTela('tela-entrar');
});
