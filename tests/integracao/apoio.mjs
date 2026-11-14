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

// CPF aleatório com os dígitos verificadores certos (passa na validação do cadastro).
export function cpfAleatorio() {
    const d = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
    for (const tamanho of [9, 10]) {
        let soma = 0;
        for (let i = 0; i < tamanho; i++) soma += d[i] * (tamanho + 1 - i);
        d.push((soma * 10) % 11 % 10);
    }
    return d.join('');
}

const usuariosCriados = [];

// Cria um usuário de teste (confirmado, se não for dito o contrário), com perfil e papéis opcionais.
// Devolve o token de login (null se o e-mail não estiver confirmado) e o CPF do perfil.
export async function criarUsuario({ papeis = [], perfil = true, confirmado = true, email = `${marcador()}@rangepass.test` } = {}) {
    const senha = `Senha-${marcador()}`;

    const criado = await chamar(`${URL}/auth/v1/admin/users`, {
        metodo: 'POST',
        corpo: { email, password: senha, email_confirm: confirmado },
    });
    if (criado.status !== 200) throw new Error(`Falha ao criar usuário: ${criado.status} ${JSON.stringify(criado.dados)}`);
    const id = criado.dados.id;
    usuariosCriados.push(id);

    let cpf = null;
    if (perfil) {
        cpf = cpfAleatorio();
        const r = await rest('perfis', {
            metodo: 'POST',
            corpo: { id, nome_completo: `Teste ${marcador()}`, cpf, telefone: '11999999999', data_nascimento: '1990-01-01' },
        });
        if (r.status !== 201) throw new Error(`Falha ao criar perfil: ${r.status} ${JSON.stringify(r.dados)}`);
    }

    if (papeis.length) {
        const r = await rest('papeis_usuario', { metodo: 'POST', corpo: papeis.map(papel => ({ usuario_id: id, papel })) });
        if (r.status !== 201) throw new Error(`Falha ao gravar papéis: ${r.status} ${JSON.stringify(r.dados)}`);
    }

    let token = null;
    if (confirmado) {
        const login = await entrar(email, senha);
        if (login.status !== 200) throw new Error(`Falha no login: ${login.status} ${JSON.stringify(login.dados)}`);
        token = login.dados.access_token;
    }

    return { id, email, senha, cpf, token };
}

// Login com e-mail e senha no Supabase Auth, como o navegador faz.
export function entrar(email, senha) {
    return chamar(`${URL}/auth/v1/token?grant_type=password`, {
        metodo: 'POST',
        corpo: { email, password: senha },
        chave: CHAVE_ANON,
    });
}

// Anota um usuário criado por outro caminho (por exemplo, pela função cadastro) para ser apagado no fim.
export function anotarUsuario(id) {
    if (!usuariosCriados.includes(id)) usuariosCriados.push(id);
}

// Maior id atual das tentativas de cadastro, para depois apagar só as que o teste gerou.
export async function ultimoIdTentativa() {
    const r = await rest('tentativas_cadastro?select=id&order=id.desc&limit=1');
    if (r.status !== 200) throw new Error(`Falha ao ler tentativas: ${r.status} ${JSON.stringify(r.dados)}`);
    return r.dados[0]?.id ?? 0;
}

// Apaga as tentativas de cadastro com id maior que o informado.
export async function apagarTentativasDepoisDe(id) {
    const r = await rest(`tentativas_cadastro?id=gt.${id}`, { metodo: 'DELETE' });
    if (r.status >= 300) throw new Error(`Falha ao apagar tentativas: ${r.status} ${JSON.stringify(r.dados)}`);
}

// Procura o id de um usuário do Auth pelo e-mail. Devolve null se não existir.
export async function idDoUsuarioPorEmail(email) {
    const r = await chamar(`${URL}/auth/v1/admin/users?page=1&per_page=1000`);
    if (r.status !== 200) throw new Error(`Falha ao listar usuários: ${r.status} ${JSON.stringify(r.dados)}`);
    return r.dados.users.find(u => u.email === email.toLowerCase())?.id ?? null;
}

// E-mail real para os testes que enviam e-mail (EMAIL_TESTE no .env.teste): a@b.com vira a+teste-...@b.com.
// Sem EMAIL_TESTE, devolve null e esses testes são pulados.
export function emailTeste() {
    const base = process.env.EMAIL_TESTE?.trim();
    if (!base || !base.includes('@')) return null;
    const [nome, dominio] = base.split('@');
    return `${nome}+${marcador()}@${dominio}`;
}

// Apaga um usuário de teste e tudo o que pertence a ele: papéis, perfil, histórico do perfil e o login.
// Um login que já não existe (por exemplo, descartado pela função cadastro) não é falha.
export async function apagarUsuario(id) {
    const passos = [
        await rest(`papeis_usuario?usuario_id=eq.${id}`, { metodo: 'DELETE' }),
        await rest(`perfis?id=eq.${id}`, { metodo: 'DELETE' }),
        await rest(`historico_alteracoes?tabela=eq.perfis&registro_id=eq.${id}`, { metodo: 'DELETE' }),
        await chamar(`${URL}/auth/v1/admin/users/${id}`, { metodo: 'DELETE' }),
    ];
    const falha = passos.find((r, i) => r.status >= 300 && !(i === passos.length - 1 && r.status === 404));
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
