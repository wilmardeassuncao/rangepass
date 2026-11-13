// tests/integracao/apoio.mjs
// Ajudantes usados pelos testes de integração para conversar com o projeto Supabase.

function lerVariavel(nome) {
    const valor = process.env[nome];
    if (!valor) {
        throw new Error(`Falta a variável ${nome}. Preencha o arquivo .env.teste (veja .env.teste.exemplo).`);
    }
    return valor;
}

export const URL = lerVariavel('SUPABASE_URL').replace(/\/+$/, '');
export const CHAVE_ANON = lerVariavel('SUPABASE_ANON_KEY');
export const CHAVE_SERVICO = lerVariavel('SUPABASE_SERVICE_ROLE_KEY');

async function chamar(endereco, { metodo = 'GET', corpo, chave = CHAVE_SERVICO, token, prefer } = {}) {
    const cabecalhos = { apikey: chave };
    if (token) cabecalhos.Authorization = `Bearer ${token}`;
    if (prefer) cabecalhos.Prefer = prefer;
    if (corpo !== undefined) cabecalhos['Content-Type'] = 'application/json';

    const resposta = await fetch(endereco, {
        method: metodo,
        headers: cabecalhos,
        body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });

    const texto = await resposta.text();
    let dados = null;
    if (texto) {
        try { dados = JSON.parse(texto); } catch { dados = texto; }
    }
    return { status: resposta.status, dados };
}

export function rest(caminho, { metodo = 'GET', corpo, chave = CHAVE_SERVICO, token, prefer = 'return=representation' } = {}) {
    return chamar(`${URL}/rest/v1/${caminho}`, { metodo, corpo, chave, token, prefer });
}

export function rpc(nome, args = {}, opcoes = {}) {
    return rest(`rpc/${nome}`, { ...opcoes, metodo: 'POST', corpo: args });
}

export function funcao(nome, { metodo = 'GET', corpo, token } = {}) {
    return chamar(`${URL}/functions/v1/${nome}`, { metodo, corpo, chave: CHAVE_ANON, token });
}

export function marcador() {
    return `teste-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
