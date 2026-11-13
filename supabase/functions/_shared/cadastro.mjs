// Regras do cadastro do cliente: CPF, idade, telefone e campos do perfil.
// Módulo puro: roda igual no Node (testes), no Deno (Edge Functions) e no navegador.

const ATENDIMENTO = 'Para mudar este dado, procure o atendimento do estande.';
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATA = /^\d{4}-\d{2}-\d{2}$/;
const EDITAVEIS = ['nome_completo', 'telefone', 'cr', 'orgao_expedidor'];
const SO_NO_ATENDIMENTO = ['cpf', 'data_nascimento'];

export function somenteDigitos(texto) {
    return typeof texto === 'string' ? texto.replace(/\D/g, '') : '';
}

export function cpfValido(cpf) {
    const d = somenteDigitos(cpf);
    if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
    for (const tamanho of [9, 10]) {
        let soma = 0;
        for (let i = 0; i < tamanho; i++) soma += Number(d[i]) * (tamanho + 1 - i);
        const digito = (soma * 10) % 11 % 10;
        if (digito !== Number(d[tamanho])) return false;
    }
    return true;
}

// Data de hoje (AAAA-MM-DD) no fuso do estande.
export function dataNoFuso(agora, fuso) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: fuso, year: 'numeric', month: '2-digit', day: '2-digit' }).format(agora);
}

// Anos completos. Quem nasceu em 29/02 completa ano em 01/03 nos anos não bissextos.
export function idadeEm(dataNascimento, hoje) {
    const [an, mn, dn] = dataNascimento.split('-').map(Number);
    const [ah, mh, dh] = hoje.split('-').map(Number);
    let idade = ah - an;
    if (mh < mn || (mh === mn && dh < dn)) idade--;
    return idade;
}

function dataReal(data) {
    if (typeof data !== 'string' || !DATA.test(data)) return false;
    const d = new Date(`${data}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === data;
}

function nomeNormalizado(nome) {
    return typeof nome === 'string' ? nome.trim().replace(/\s+/g, ' ') : '';
}

// Confere um campo editável. Devolve [valorNormalizado, mensagemDeErro].
function conferirEditavel(campo, valor) {
    if (campo === 'nome_completo') {
        const nome = nomeNormalizado(valor);
        return nome.split(' ').length >= 2 ? [nome] : [null, 'Informe o nome completo.'];
    }
    if (campo === 'telefone') {
        const tel = somenteDigitos(valor);
        return tel.length === 10 || tel.length === 11 ? [tel] : [null, 'Informe o telefone com DDD.'];
    }
    // cr e orgao_expedidor: opcionais.
    if (valor === undefined || valor === null) return [null];
    if (typeof valor !== 'string') return [null, 'Revise este campo.'];
    return [valor.trim() || null];
}

export function validarCadastro(dados, { idadeMinima, hoje, versaoPolitica }) {
    const d = dados && typeof dados === 'object' ? dados : {};
    const campos = {};
    const perfil = {};

    const email = typeof d.email === 'string' ? d.email.trim().toLowerCase() : '';
    if (!EMAIL.test(email)) campos.email = 'Informe um e-mail válido.';
    if (typeof d.senha !== 'string' || d.senha === '') campos.senha = 'Crie uma senha.';

    for (const campo of EDITAVEIS) {
        const [valor, erro] = conferirEditavel(campo, d[campo]);
        if (erro) campos[campo] = erro;
        perfil[campo] = valor;
    }

    if (cpfValido(d.cpf)) perfil.cpf = somenteDigitos(d.cpf);
    else campos.cpf = 'Informe um CPF válido.';

    if (!dataReal(d.data_nascimento) || d.data_nascimento > hoje) {
        campos.data_nascimento = 'Informe a data de nascimento.';
    } else if (idadeEm(d.data_nascimento, hoje) < idadeMinima) {
        campos.data_nascimento = `É preciso ter pelo menos ${idadeMinima} anos para criar uma conta.`;
    } else {
        perfil.data_nascimento = d.data_nascimento;
    }

    if (d.aceite_politica_versao !== versaoPolitica) {
        campos.aceite_politica_versao = 'Para criar a conta, aceite a política de privacidade.';
    }

    return {
        campos,
        conta: { email, senha: d.senha },
        perfil: {
            nome_completo: perfil.nome_completo, cpf: perfil.cpf, telefone: perfil.telefone,
            data_nascimento: perfil.data_nascimento, cr: perfil.cr, orgao_expedidor: perfil.orgao_expedidor,
        },
    };
}

export function validarEdicaoPerfil(dados) {
    const d = dados && typeof dados === 'object' ? dados : {};
    const campos = {};
    const alteracoes = {};
    for (const [campo, valor] of Object.entries(d)) {
        if (SO_NO_ATENDIMENTO.includes(campo)) {
            campos[campo] = ATENDIMENTO;
        } else if (!EDITAVEIS.includes(campo)) {
            campos[campo] = 'Este campo não existe.';
        } else {
            const [normalizado, erro] = conferirEditavel(campo, valor);
            if (erro) campos[campo] = erro;
            else alteracoes[campo] = normalizado;
        }
    }
    if (Object.keys(d).length === 0) campos.geral = 'Nada para alterar.';
    return { campos, alteracoes };
}
