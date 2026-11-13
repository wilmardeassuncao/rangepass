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

export function cpfAleatorio() {
    let cpf = '';
    for (let i = 0; i < 11; i++) cpf += Math.floor(Math.random() * 10);
    return cpf;
}

const usuariosCriados = [];

// Cria um usuário de teste já confirmado, com perfil e papéis opcionais, e devolve o token de login.
export async function criarUsuario({ papeis = [], perfil = true } = {}) {
    const email = `${marcador()}@rangepass.test`;
    const senha = `Senha-${marcador()}`;

    const criado = await chamar(`${URL}/auth/v1/admin/users`, {
        metodo: 'POST',
        corpo: { email, password: senha, email_confirm: true },
    });
    if (criado.status !== 200) throw new Error(`Falha ao criar usuário: ${criado.status} ${JSON.stringify(criado.dados)}`);
    const id = criado.dados.id;
    usuariosCriados.push(id);

    if (perfil) {
        const r = await rest('perfis', {
            metodo: 'POST',
            corpo: { id, nome_completo: `Teste ${marcador()}`, cpf: cpfAleatorio(), telefone: '11999999999', data_nascimento: '1990-01-01' },
        });
        if (r.status !== 201) throw new Error(`Falha ao criar perfil: ${r.status} ${JSON.stringify(r.dados)}`);
    }

    if (papeis.length) {
        const r = await rest('papeis_usuario', { metodo: 'POST', corpo: papeis.map(papel => ({ usuario_id: id, papel })) });
        if (r.status !== 201) throw new Error(`Falha ao gravar papéis: ${r.status} ${JSON.stringify(r.dados)}`);
    }

    const login = await chamar(`${URL}/auth/v1/token?grant_type=password`, {
        metodo: 'POST',
        corpo: { email, password: senha },
        chave: CHAVE_ANON,
    });
    if (login.status !== 200) throw new Error(`Falha no login: ${login.status} ${JSON.stringify(login.dados)}`);

    return { id, email, senha, token: login.dados.access_token };
}

// Apaga um usuário de teste e tudo o que pertence a ele: papéis, perfil, histórico do perfil e o login.
export async function apagarUsuario(id) {
    const passos = [
        await rest(`papeis_usuario?usuario_id=eq.${id}`, { metodo: 'DELETE' }),
        await rest(`perfis?id=eq.${id}`, { metodo: 'DELETE' }),
        await rest(`historico_alteracoes?tabela=eq.perfis&registro_id=eq.${id}`, { metodo: 'DELETE' }),
        await chamar(`${URL}/auth/v1/admin/users/${id}`, { metodo: 'DELETE' }),
    ];
    const falha = passos.find(r => r.status >= 300);
    if (falha) throw new Error(`Falha ao apagar usuário ${id}: ${falha.status} ${JSON.stringify(falha.dados)}`);
}

// Executa cada passo de limpeza mesmo que um anterior falhe; no fim, avisa de todas as falhas juntas.
async function executarTodos(passos) {
    const falhas = [];
    for (const passo of passos) {
        try {
            await passo();
        } catch (erro) {
            falhas.push(erro.message);
        }
    }
    if (falhas.length) throw new Error(`A limpeza dos testes deixou resíduo:\n${falhas.join('\n')}`);
}

// Apaga todos os usuários criados por criarUsuario neste arquivo de teste. Usar em after().
export async function apagarUsuariosCriados() {
    const ids = usuariosCriados.splice(0).reverse();
    await executarTodos(ids.map(id => () => apagarUsuario(id)));
}

// Maior id atual do histórico, para depois apagar só as linhas que o teste gerou.
export async function ultimoIdHistorico() {
    const r = await rest('historico_alteracoes?select=id&order=id.desc&limit=1');
    return r.dados[0]?.id ?? 0;
}

const registrosCriados = [];

// Tenta inserir um registro de teste; se o banco aceitar, anota para apagar depois. Devolve a resposta.
export async function tentarCriar(tabela, corpo) {
    const r = await rest(tabela, { metodo: 'POST', corpo });
    if (r.status === 201) registrosCriados.push({ tabela, id: r.dados[0].id });
    return r;
}

// Insere um registro de teste e anota para apagar depois. Devolve a linha criada.
export async function criar(tabela, corpo) {
    const r = await tentarCriar(tabela, corpo);
    if (r.status !== 201) throw new Error(`Falha ao criar em ${tabela}: ${r.status} ${JSON.stringify(r.dados)}`);
    return r.dados[0];
}

// Apaga, do mais novo para o mais antigo, tudo o que criar() inseriu, junto com o histórico gerado. Usar em after().
export async function apagarCriados() {
    const registros = registrosCriados.splice(0).reverse();
    await executarTodos(registros.map(({ tabela, id }) => async () => {
        const r = await rest(`${tabela}?id=eq.${id}`, { metodo: 'DELETE' });
        if (r.status >= 300) throw new Error(`Falha ao apagar ${tabela} ${id}: ${r.status} ${JSON.stringify(r.dados)}`);
        const h = await rest(`historico_alteracoes?tabela=eq.${tabela}&registro_id=eq.${id}`, { metodo: 'DELETE' });
        if (h.status >= 300) throw new Error(`Falha ao apagar o histórico de ${tabela} ${id}: ${h.status} ${JSON.stringify(h.dados)}`);
    }));
}

// Apaga primeiro os registros e depois os usuários, mesmo que a primeira parte falhe. Usar em after().
export async function apagarTudoCriado() {
    await executarTodos([apagarCriados, apagarUsuariosCriados]);
}

// Bloqueia o login de um usuário no Supabase Auth (é assim que uma conta é desativada).
export async function banirUsuario(id) {
    const r = await chamar(`${URL}/auth/v1/admin/users/${id}`, { metodo: 'PUT', corpo: { ban_duration: '876000h' } });
    if (r.status !== 200) throw new Error(`Falha ao banir usuário ${id}: ${r.status} ${JSON.stringify(r.dados)}`);
}
