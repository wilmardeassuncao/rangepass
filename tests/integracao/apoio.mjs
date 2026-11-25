// tests/integracao/apoio.mjs
// Ajudantes usados pelos testes de integração para conversar com o projeto Supabase.
import { dataNoFuso } from '../../supabase/functions/_shared/cadastro.mjs';
import { horariosDoDia } from '../../supabase/functions/_shared/agendamento.mjs';

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

// Apaga um usuário de teste e tudo o que pertence a ele: papéis, perfil, histórico (perfil, papéis e conta) e o login.
// Um login que já não existe (por exemplo, descartado pela função cadastro) não é falha.
export async function apagarUsuario(id) {
    const passos = [
        await rest(`papeis_usuario?usuario_id=eq.${id}`, { metodo: 'DELETE' }),
        await rest(`perfis?id=eq.${id}`, { metodo: 'DELETE' }),
        await rest(`historico_alteracoes?tabela=eq.perfis&registro_id=eq.${id}`, { metodo: 'DELETE' }),
        await rest(`historico_alteracoes?tabela=eq.papeis_usuario&registro_id=eq.${id}`, { metodo: 'DELETE' }),
        await rest(`historico_alteracoes?tabela=eq.contas&registro_id=eq.${id}`, { metodo: 'DELETE' }),
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

// Anota um registro criado por outro caminho (por exemplo, pela função catalogo) para ser apagado no fim,
// junto com o histórico, como os de criar().
export function anotarRegistro(tabela, id) {
    if (!registrosCriados.some(r => r.tabela === tabela && r.id === id)) registrosCriados.push({ tabela, id });
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

const agendamentosAnotados = [];

// Anota um agendamento criado pela RPC criar_agendamento (ou pela função agendar) para ser apagado no fim.
export function anotarAgendamento(id) {
    if (!agendamentosAnotados.includes(id)) agendamentosAnotados.push(id);
}

// Apaga as linhas pedidas de uma tabela e o histórico de cada uma. Devolve os ids apagados.
async function apagarLinhasComHistorico(tabela, filtro) {
    const lidas = await rest(`${tabela}?${filtro}&select=id`);
    if (lidas.status !== 200) throw new Error(`Falha ao ler ${tabela}: ${lidas.status} ${JSON.stringify(lidas.dados)}`);
    const ids = lidas.dados.map(l => l.id);
    if (!ids.length) return ids;
    const lista = `in.(${ids.join(',')})`;
    const r = await rest(`${tabela}?id=${lista}`, { metodo: 'DELETE' });
    if (r.status >= 300) throw new Error(`Falha ao apagar ${tabela}: ${r.status} ${JSON.stringify(r.dados)}`);
    const h = await rest(`historico_alteracoes?tabela=eq.${tabela}&registro_id=${lista}`, { metodo: 'DELETE' });
    if (h.status >= 300) throw new Error(`Falha ao apagar o histórico de ${tabela}: ${h.status} ${JSON.stringify(h.dados)}`);
    return ids;
}

// Apaga cada agendamento anotado com as reservas, os participantes, os itens e o histórico de cada linha.
export async function apagarAgendamentosAnotados() {
    const ids = agendamentosAnotados.splice(0).reverse();
    await executarTodos(ids.map(id => async () => {
        for (const tabela of ['agendamento_unidades', 'agendamento_instrutores', 'agendamento_pistas']) {
            await apagarLinhasComHistorico(tabela, `agendamento_id=eq.${id}`);
        }
        const lidos = await rest(`participantes?agendamento_id=eq.${id}&select=id`);
        if (lidos.status !== 200) throw new Error(`Falha ao ler participantes: ${lidos.status} ${JSON.stringify(lidos.dados)}`);
        const participantes = lidos.dados.map(l => l.id);
        if (participantes.length) {
            await apagarLinhasComHistorico('itens_participante', `participante_id=in.(${participantes.join(',')})`);
        }
        await apagarLinhasComHistorico('participantes', `agendamento_id=eq.${id}`);
        await apagarLinhasComHistorico('agendamentos', `id=eq.${id}`);
    }));
}

// Apaga primeiro os agendamentos anotados, depois os registros e por fim os usuários,
// mesmo que uma parte falhe. Usar em after().
export async function apagarTudoCriado() {
    await executarTodos([apagarAgendamentosAnotados, apagarCriados, apagarUsuariosCriados]);
}

// Bloqueia o login de um usuário no Supabase Auth (é assim que uma conta é desativada).
export async function banirUsuario(id) {
    const r = await chamar(`${URL}/auth/v1/admin/users/${id}`, { metodo: 'PUT', corpo: { ban_duration: '876000h' } });
    if (r.status !== 200) throw new Error(`Falha ao banir usuário ${id}: ${r.status} ${JSON.stringify(r.dados)}`);
}

// Usuário do Supabase Auth (com banned_until), pelo id.
export async function usuarioDoAuth(id) {
    const r = await chamar(`${URL}/auth/v1/admin/users/${id}`);
    if (r.status !== 200) throw new Error(`Falha ao ler usuário ${id}: ${r.status} ${JSON.stringify(r.dados)}`);
    return r.dados;
}

// Desfaz o banirUsuario: o login volta a funcionar.
export async function desbanirUsuario(id) {
    const r = await chamar(`${URL}/auth/v1/admin/users/${id}`, { metodo: 'PUT', corpo: { ban_duration: 'none' } });
    if (r.status !== 200) throw new Error(`Falha ao desbanir usuário ${id}: ${r.status} ${JSON.stringify(r.dados)}`);
}

// Apaga os registros de acesso a dados (acessos_dados) feitos por um usuário de teste.
export async function apagarAcessosDe(usuarioId) {
    const r = await rest(`acessos_dados?usuario_id=eq.${usuarioId}`, { metodo: 'DELETE' });
    if (r.status >= 300) throw new Error(`Falha ao apagar os acessos de ${usuarioId}: ${r.status} ${JSON.stringify(r.dados)}`);
}

// Valor de teste da hora de pista, usado só quando o estande ainda não definiu o dele.
export const HORA_PISTA_DE_TESTE = 10000;

async function lerLinhaPrecos() {
    const r = await rest('configuracoes?chave=eq.precos&select=valor,atualizado_em,atualizado_por');
    if (r.status !== 200 || r.dados.length !== 1) throw new Error(`Falha ao ler configuracoes.precos: ${r.status} ${JSON.stringify(r.dados)}`);
    return r.dados[0];
}

// Muda o valor de configuracoes.precos (por exemplo, para deixar a hora de pista vazia num teste).
// Quem chama precisa ter chamado definirPrecosDeTeste antes, que restaura a linha no fim.
export async function gravarPrecosDaConfiguracao(valor) {
    const r = await rest('configuracoes?chave=eq.precos', { metodo: 'PATCH', corpo: { valor } });
    if (r.status !== 200) throw new Error(`Falha ao gravar configuracoes.precos: ${r.status} ${JSON.stringify(r.dados)}`);
}

// Grava preços nos itens criados pelo teste (modelos: preço da hora; tiposMunicao: preço da unidade)
// e, se a hora de pista do estande estiver vazia, o valor de teste. Devolve uma função que restaura a
// linha configuracoes.precos exatamente (valor, data e autor) e apaga o histórico gerado nela.
// Os itens do teste são apagados com o histórico pelo apagarCriados, como sempre.
export async function definirPrecosDeTeste({ modelos = [], tiposMunicao = [] } = {}) {
    const linhaAnterior = await lerLinhaPrecos();
    const ultimoId = await ultimoIdHistorico();
    const restaurar = async () => {
        const volta = await rest('configuracoes?chave=eq.precos', { metodo: 'PATCH', corpo: linhaAnterior });
        if (volta.status !== 200) throw new Error(`Falha ao restaurar configuracoes.precos: ${volta.status} ${JSON.stringify(volta.dados)}`);
        const limpa = await rest(`historico_alteracoes?tabela=eq.configuracoes&registro_id=eq.precos&id=gt.${ultimoId}`, { metodo: 'DELETE' });
        if (limpa.status >= 300) throw new Error(`Falha ao apagar o histórico de configuracoes.precos: ${limpa.status} ${JSON.stringify(limpa.dados)}`);
    };
    try {
        for (const { id, preco } of modelos) {
            const r = await rest(`modelos?id=eq.${id}`, { metodo: 'PATCH', corpo: { preco_hora_centavos: preco } });
            if (r.status !== 200 || r.dados.length !== 1) throw new Error(`Falha ao gravar o preço do modelo ${id}: ${r.status} ${JSON.stringify(r.dados)}`);
        }
        for (const { id, preco } of tiposMunicao) {
            const r = await rest(`tipos_municao?id=eq.${id}`, { metodo: 'PATCH', corpo: { preco_unidade_centavos: preco } });
            if (r.status !== 200 || r.dados.length !== 1) throw new Error(`Falha ao gravar o preço da munição ${id}: ${r.status} ${JSON.stringify(r.dados)}`);
        }
        if (!Number.isInteger(linhaAnterior.valor?.hora_pista_centavos)) {
            await gravarPrecosDaConfiguracao({ ...linhaAnterior.valor, hora_pista_centavos: HORA_PISTA_DE_TESTE });
        }
    } catch (erro) {
        await restaurar();
        throw erro;
    }
    return restaurar;
}

// Primeiro dia, a partir de hoje (no fuso do estande) + dias, em que o estande abre com pelo menos
// minHoras horários de início (dias curtos, como o sábado, ficam de fora quando o teste precisa de mais).
// Devolve a data (AAAA-MM-DD) e as horas de início possíveis nesse dia.
export async function diaAbertoDeTeste(dias, minHoras = 1) {
    const r = await rest('configuracoes?chave=in.(funcionamento,estande)&select=chave,valor');
    if (r.status !== 200) throw new Error(`Falha ao ler configuracoes: ${r.status} ${JSON.stringify(r.dados)}`);
    const config = Object.fromEntries(r.dados.map(l => [l.chave, l.valor]));
    const hoje = dataNoFuso(new Date(), config.estande.fuso);
    for (let i = dias; i < dias + 366; i++) {
        const d = new Date(`${hoje}T00:00:00Z`);
        d.setUTCDate(d.getUTCDate() + i);
        const data = d.toISOString().slice(0, 10);
        const horas = horariosDoDia(data, config.funcionamento);
        if (horas.length >= minHoras) return { data, horas };
    }
    throw new Error('O estande não abre em nenhum dia do próximo ano.');
}
