// tests/integracao/catalogo-funcao.test.mjs
// A Edge Function catalogo: o superadmin cadastra e edita categorias, calibres, modelos, munições,
// armas do estande e pistas. Nada é apagado por ela; os testes apagam tudo o que criam.
import test, { after, before } from 'node:test';
import assert from 'node:assert';
import {
    rest, rpc, funcao, marcador, criarUsuario, anotarRegistro, anotarAgendamento, apagarTudoCriado,
} from './apoio.mjs';

after(apagarTudoCriado);

const TABELAS = {
    categoria: 'categorias', calibre: 'calibres', modelo: 'modelos',
    tipo_municao: 'tipos_municao', unidade: 'unidades_arma', pista: 'pistas',
};

let superadmin, administrativo, cliente, instrutor;
const criados = {};

before(async () => {
    superadmin = await criarUsuario({ papeis: ['superadmin'] });
    administrativo = await criarUsuario({ papeis: ['administrativo'] });
    cliente = await criarUsuario({ papeis: ['cliente'] });
    instrutor = await criarUsuario({ papeis: ['instrutor'] });
});

// Cria pela função; se der certo, anota a linha para apagar no fim (com o histórico).
async function cadastrar(tipo, dados, token = superadmin.token) {
    const r = await funcao('catalogo', { metodo: 'POST', token, corpo: { tipo, dados } });
    if (r.status === 201 && r.dados?.item?.id) anotarRegistro(TABELAS[tipo], r.dados.item.id);
    return r;
}

function editar(tipo, id, dados, token = superadmin.token) {
    return funcao('catalogo', { metodo: 'PUT', token, corpo: { tipo, id, dados } });
}

function numeroPista() {
    return 100000000 + Math.floor(Math.random() * 1000000000);
}

async function criarTudo() {
    if (criados.pista) return criados;
    const m = marcador();
    const passos = [
        ['categoria', () => ({ nome: ` Categoria ${m} ` })],
        ['calibre', () => ({ nome: `Calibre ${m}` })],
        ['modelo', () => ({ categoria_id: criados.categoria.id, calibre_id: criados.calibre.id, marca: `Marca ${m}`, nome: 'Modelo Teste' })],
        ['tipo_municao', () => ({ calibre_id: criados.calibre.id, nome: `Munição ${m}` })],
        ['unidade', () => ({ modelo_id: criados.modelo.id, numero_registro: `REG-${m}` })],
        ['pista', () => ({ numero: numeroPista() })],
    ];
    for (const [tipo, dados] of passos) {
        const r = await cadastrar(tipo, dados());
        assert.strictEqual(r.status, 201, `${tipo}: ${r.status} ${JSON.stringify(r.dados)}`);
        criados[tipo] = r.dados.item;
    }
    return criados;
}

test('sem login dá 401', async () => {
    const r = await funcao('catalogo');
    assert.strictEqual(r.status, 401, JSON.stringify(r.dados));
});

test('cliente, administrativo e instrutor recebem 403 em GET, POST e PUT', async () => {
    for (const pessoa of [cliente, administrativo, instrutor]) {
        const g = await funcao('catalogo', { token: pessoa.token });
        const p = await cadastrar('categoria', { nome: `Categoria ${marcador()}` }, pessoa.token);
        const u = await editar('categoria', 1, { ativo: true }, pessoa.token);
        for (const r of [g, p, u]) {
            assert.strictEqual(r.status, 403, JSON.stringify(r.dados));
            assert.strictEqual(r.dados.erro, 'Você não tem permissão para fazer isso.');
        }
    }
});

test('outros métodos dão 405', async () => {
    const r = await funcao('catalogo', { metodo: 'DELETE', token: superadmin.token });
    assert.strictEqual(r.status, 405, JSON.stringify(r.dados));
});

test('superadmin cria um de cada tipo; o GET traz todos; o histórico tem o autor', async () => {
    const c = await criarTudo();
    assert.strictEqual(c.categoria.nome, c.categoria.nome.trim(), 'nome com trim');
    assert.match(c.categoria.nome, /^Categoria teste-/);
    assert.strictEqual(c.unidade.situacao, 'disponivel');

    const r = await funcao('catalogo', { token: superadmin.token });
    assert.strictEqual(r.status, 200, JSON.stringify(r.dados));
    const listas = {
        categoria: r.dados.categorias, calibre: r.dados.calibres, modelo: r.dados.modelos,
        tipo_municao: r.dados.tipos_municao, unidade: r.dados.unidades, pista: r.dados.pistas,
    };
    for (const [tipo, lista] of Object.entries(listas)) {
        const achado = lista.find(item => item.id === c[tipo].id);
        assert.ok(achado, `${tipo} não veio no GET`);
        assert.deepStrictEqual(achado, c[tipo], tipo);
    }
    assert.deepStrictEqual(Object.keys(listas.unidade[0]).sort(), ['id', 'modelo_id', 'numero_registro', 'situacao']);

    for (const [tipo, item] of Object.entries(c)) {
        const h = await rest(`historico_alteracoes?tabela=eq.${TABELAS[tipo]}&registro_id=eq.${item.id}&select=feito_por,acao`);
        assert.strictEqual(h.status, 200, JSON.stringify(h.dados));
        assert.strictEqual(h.dados.length, 1, `${tipo}: ${JSON.stringify(h.dados)}`);
        assert.strictEqual(h.dados[0].feito_por, superadmin.id, tipo);
    }
});

test('nome repetido de categoria dá 409 com a mensagem da tabela', async () => {
    const c = await criarTudo();
    const r = await cadastrar('categoria', { nome: c.categoria.nome });
    assert.strictEqual(r.status, 409, JSON.stringify(r.dados));
    assert.deepStrictEqual(r.dados.campos, { nome: 'Já existe um cadastro com este nome.' });
});

test('nº de registro repetido dá 409 com a mensagem da tabela', async () => {
    const c = await criarTudo();
    const r = await cadastrar('unidade', { modelo_id: c.modelo.id, numero_registro: c.unidade.numero_registro });
    assert.strictEqual(r.status, 409, JSON.stringify(r.dados));
    assert.deepStrictEqual(r.dados.campos, { numero_registro: 'Já existe uma arma com este número de registro.' });
});

test('campos inválidos dão 400 com campos', async () => {
    const r = await cadastrar('pista', { numero: -1 });
    assert.strictEqual(r.status, 400, JSON.stringify(r.dados));
    assert.strictEqual(r.dados.erro, 'Revise os campos destacados.');
    assert.strictEqual(r.dados.campos.numero, 'Informe um número inteiro maior que 0.');
});

test('item escolhido que não existe dá 400', async () => {
    const r = await cadastrar('unidade', { modelo_id: 2000000000, numero_registro: `REG-${marcador()}` });
    assert.strictEqual(r.status, 400, JSON.stringify(r.dados));
    assert.strictEqual(r.dados.erro, 'Um dos itens escolhidos não existe mais. Recarregue a página.');
});

test('PUT mudando calibre_id de um modelo dá 400', async () => {
    const c = await criarTudo();
    const r = await editar('modelo', c.modelo.id, { calibre_id: c.calibre.id });
    assert.strictEqual(r.status, 400, JSON.stringify(r.dados));
    assert.strictEqual(r.dados.campos.calibre_id, 'Este campo não pode ser mudado aqui.');
});

test('PUT muda só o que foi enviado e grava o autor', async () => {
    const c = await criarTudo();
    const r = await editar('modelo', c.modelo.id, { nome: ' Modelo Editado ' });
    assert.strictEqual(r.status, 200, JSON.stringify(r.dados));
    assert.deepStrictEqual(r.dados, { item: { ...c.modelo, nome: 'Modelo Editado' }, reservas_futuras: 0 });
    const h = await rest(`historico_alteracoes?tabela=eq.modelos&registro_id=eq.${c.modelo.id}&acao=eq.alteracao&select=feito_por`);
    assert.deepStrictEqual(h.dados, [{ feito_por: superadmin.id }]);
});

test('desativar uma unidade com agendamento futuro devolve reservas_futuras 1 e mantém a reserva', async () => {
    const c = await criarTudo();
    const pedido = {
        inicio: '2030-09-03T10:00:00-03:00', horas: 1, instrutor_id: instrutor.id, instrutores_necessarios: 1,
        participantes: [{
            nome_completo: 'Cliente Teste', cpf: cliente.cpf, data_nascimento: '1990-01-01', perfil_id: cliente.id,
            modalidade: 'estande', termo_versao: null, modelo_id: c.modelo.id,
            tipo_municao_id: c.tipo_municao.id, municao_qtd: 50, arma_propria: null,
        }],
    };
    const ag = await rpc('criar_agendamento', { p_responsavel: cliente.id, p_pedido: pedido });
    assert.strictEqual(ag.status, 200, JSON.stringify(ag.dados));
    anotarAgendamento(ag.dados);

    const r = await editar('unidade', c.unidade.id, { situacao: 'manutencao' });
    assert.strictEqual(r.status, 200, JSON.stringify(r.dados));
    assert.strictEqual(r.dados.reservas_futuras, 1);
    assert.strictEqual(r.dados.item.situacao, 'manutencao');

    const reservas = await rest(`agendamento_unidades?agendamento_id=eq.${ag.dados}&select=unidade_id,ativo`);
    assert.deepStrictEqual(reservas.dados, [{ unidade_id: c.unidade.id, ativo: true }]);

    // Mudar outra coisa não conta reservas.
    const outra = await editar('unidade', c.unidade.id, { numero_registro: `${c.unidade.numero_registro}-B` });
    assert.strictEqual(outra.dados.reservas_futuras, 0, JSON.stringify(outra.dados));
});

test('PUT grava e tira o preço do modelo e da munição; o GET traz o preço', async () => {
    const c = await criarTudo();
    assert.strictEqual(c.modelo.preco_hora_centavos, null);
    assert.strictEqual(c.tipo_municao.preco_unidade_centavos, null);
    try {
        const m = await editar('modelo', c.modelo.id, { preco_hora_centavos: 4000 });
        assert.strictEqual(m.status, 200, JSON.stringify(m.dados));
        assert.strictEqual(m.dados.item.preco_hora_centavos, 4000);
        const t = await editar('tipo_municao', c.tipo_municao.id, { preco_unidade_centavos: 350 });
        assert.strictEqual(t.status, 200, JSON.stringify(t.dados));
        assert.strictEqual(t.dados.item.preco_unidade_centavos, 350);

        const g = await funcao('catalogo', { token: superadmin.token });
        assert.strictEqual(g.dados.modelos.find(i => i.id === c.modelo.id).preco_hora_centavos, 4000);
        assert.strictEqual(g.dados.tipos_municao.find(i => i.id === c.tipo_municao.id).preco_unidade_centavos, 350);

        const ruim = await editar('modelo', c.modelo.id, { preco_hora_centavos: 0 });
        assert.strictEqual(ruim.status, 400, JSON.stringify(ruim.dados));
        assert.strictEqual(ruim.dados.campos.preco_hora_centavos, 'Informe um valor maior que zero.');
    } finally {
        // Volta a "sem preço", como os outros testes esperam.
        const a = await editar('modelo', c.modelo.id, { preco_hora_centavos: null });
        assert.strictEqual(a.status, 200, JSON.stringify(a.dados));
        assert.strictEqual(a.dados.item.preco_hora_centavos, null);
        const b = await editar('tipo_municao', c.tipo_municao.id, { preco_unidade_centavos: null });
        assert.strictEqual(b.status, 200, JSON.stringify(b.dados));
    }
});

test('salva e tira o custo de compra da munição', async () => {
    const c = await criarTudo();
    assert.strictEqual(c.tipo_municao.custo_compra_centavos, null);
    try {
        const r = await editar('tipo_municao', c.tipo_municao.id, { custo_compra_centavos: 1500 });
        assert.strictEqual(r.status, 200, JSON.stringify(r.dados));
        assert.strictEqual(r.dados.item.custo_compra_centavos, 1500);
        const g = await funcao('catalogo', { token: superadmin.token });
        assert.strictEqual(g.dados.tipos_municao.find(i => i.id === c.tipo_municao.id).custo_compra_centavos, 1500);
        const banco = await rest(`tipos_municao?id=eq.${c.tipo_municao.id}&select=custo_compra_centavos`);
        assert.deepStrictEqual(banco.dados, [{ custo_compra_centavos: 1500 }]);

        // O preço e o custo vão juntos pelo mesmo PUT (o botão Salvar da aba Preços).
        const juntos = await editar('tipo_municao', c.tipo_municao.id, { preco_unidade_centavos: 300, custo_compra_centavos: 120 });
        assert.strictEqual(juntos.status, 200, JSON.stringify(juntos.dados));
        assert.strictEqual(juntos.dados.item.preco_unidade_centavos, 300);
        assert.strictEqual(juntos.dados.item.custo_compra_centavos, 120);

        const ruim = await editar('tipo_municao', c.tipo_municao.id, { custo_compra_centavos: 0 });
        assert.strictEqual(ruim.status, 400, JSON.stringify(ruim.dados));
        assert.strictEqual(ruim.dados.campos.custo_compra_centavos, 'Informe um valor maior que zero.');

        const tira = await editar('tipo_municao', c.tipo_municao.id, { custo_compra_centavos: null });
        assert.strictEqual(tira.status, 200, JSON.stringify(tira.dados));
        assert.strictEqual(tira.dados.item.custo_compra_centavos, null);
    } finally {
        // Volta a "sem preço e sem custo", como os outros testes esperam.
        const volta = await editar('tipo_municao', c.tipo_municao.id, { preco_unidade_centavos: null, custo_compra_centavos: null });
        assert.strictEqual(volta.status, 200, JSON.stringify(volta.dados));
    }
});

test('o banco recusa preço 0 no modelo', async () => {
    const c = await criarTudo();
    const r = await rest(`modelos?id=eq.${c.modelo.id}`, { metodo: 'PATCH', corpo: { preco_hora_centavos: 0 } });
    assert.strictEqual(r.dados?.code, '23514', `${r.status} ${JSON.stringify(r.dados)}`);
});

// --- salvar_promocao (a RPC das regras por horário, campanhas, classes e pacotes) ---

const TABELAS_PROMOCAO = { regra: 'regras_preco', campanha: 'campanhas', classe: 'classes_desconto', pacote: 'pacotes' };

async function promover(tipo, id, dados, autor = superadmin.id) {
    const r = await rpc('salvar_promocao', { p_tipo: tipo, p_id: id, p_dados: dados, p_autor: autor });
    if (r.status === 200 && id === null && r.dados?.id) anotarRegistro(TABELAS_PROMOCAO[tipo], r.dados.id);
    return r;
}

test('salvar_promocao cria e edita cada tipo, com o autor no histórico', async () => {
    const c = await criarTudo();
    const m = marcador();
    const casos = [
        ['regra',
            { nome: `Sábado à noite ${m}`, dias: [6], hora_inicio: '18:00', hora_fim: '23:00', percentual: 20 },
            { dias: [6], hora_inicio: '18:00:00', hora_fim: '23:00:00', percentual: 20, prioridade: 0, ativo: true },
            { percentual: -10, dias: [0, 6], prioridade: 2 },
            { percentual: -10, dias: [0, 6], prioridade: 2 }],
        ['campanha',
            { nome: `Black Friday ${m}`, percentual: 10, inicio: '2030-11-20', fim: '2030-11-30' },
            { percentual: 10, inicio: '2030-11-20', fim: '2030-11-30', ativo: true },
            { fim: '2030-12-01', ativo: false },
            { fim: '2030-12-01', ativo: false }],
        ['classe',
            { nome: `Policiais ${m}`, percentual_pista: 15, percentual_aluguel: 10, percentual_municao: 5 },
            { percentual_pista: 15, percentual_aluguel: 10, percentual_municao: 5, ativo: true },
            { percentual_municao: 20 },
            { percentual_pista: 15, percentual_aluguel: 10, percentual_municao: 20 }],
        ['pacote',
            { nome: `Iniciante ${m}`, inicio: '2030-01-01', fim: '2030-12-31', preco_centavos: 25000, horas: 1,
                modelo_id: c.modelo.id, tipo_municao_id: c.tipo_municao.id, municao_qtd: 50 },
            { preco_centavos: 25000, horas: 1, modelo_id: c.modelo.id, tipo_municao_id: c.tipo_municao.id, municao_qtd: 50, ativo: true },
            { modelo_id: null, tipo_municao_id: null, municao_qtd: null, horas: 2 },
            { modelo_id: null, tipo_municao_id: null, municao_qtd: null, horas: 2 }],
    ];
    for (const [tipo, dados, esperado, edicao, esperadoEdicao] of casos) {
        const r = await promover(tipo, null, dados);
        assert.strictEqual(r.status, 200, `${tipo}: ${JSON.stringify(r.dados)}`);
        for (const [campo, valor] of Object.entries({ nome: dados.nome, ...esperado })) {
            assert.deepStrictEqual(r.dados[campo], valor, `${tipo}.${campo}`);
        }
        const e = await promover(tipo, r.dados.id, edicao, administrativo.id);
        assert.strictEqual(e.status, 200, `${tipo}: ${JSON.stringify(e.dados)}`);
        for (const [campo, valor] of Object.entries(esperadoEdicao)) {
            assert.deepStrictEqual(e.dados[campo], valor, `${tipo}.${campo} (edição)`);
        }
        assert.strictEqual(e.dados.nome, dados.nome, `${tipo}: a edição não muda o que não veio`);

        const h = await rest(`historico_alteracoes?tabela=eq.${TABELAS_PROMOCAO[tipo]}&registro_id=eq.${r.dados.id}&select=acao,feito_por&order=id`);
        assert.deepStrictEqual(h.dados, [
            { acao: 'insercao', feito_por: superadmin.id },
            { acao: 'alteracao', feito_por: administrativo.id },
        ], tipo);
    }
});

test('salvar_promocao: o banco recusa percentual 0 numa regra', async () => {
    const r = await promover('regra', null, { nome: `Regra ${marcador()}`, dias: [1], hora_inicio: '08:00', hora_fim: '12:00', percentual: 0 });
    assert.strictEqual(r.dados?.code, '23514', `${r.status} ${JSON.stringify(r.dados)}`);
});

test('salvar_promocao: tipo, campo ou id que não existe', async () => {
    assertCodigo(await promover('xyz', null, { nome: 'A' }), '22023');
    assertCodigo(await promover('classe', null, { nome: `Classe ${marcador()}`, percentual_pista: 10, percentual_aluguel: 0, percentual_municao: 0, cor: 'azul' }), '22023');
    assertCodigo(await promover('classe', 2000000000, { percentual_pista: 10 }), 'P0002');
});

function assertCodigo(r, codigo) {
    assert.strictEqual(r.dados?.code, codigo, `${r.status} ${JSON.stringify(r.dados)}`);
}

test('PUT com id inexistente dá 404', async () => {
    const r = await editar('categoria', 2000000000, { ativo: false });
    assert.strictEqual(r.status, 404, JSON.stringify(r.dados));
    assert.strictEqual(r.dados.erro, 'Não encontramos este cadastro.');
});
