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

test('cliente e administrativo recebem 403 em GET, POST e PUT', async () => {
    for (const pessoa of [cliente, administrativo]) {
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

test('PUT com id inexistente dá 404', async () => {
    const r = await editar('categoria', 2000000000, { ativo: false });
    assert.strictEqual(r.status, 404, JSON.stringify(r.dados));
    assert.strictEqual(r.dados.erro, 'Não encontramos este cadastro.');
});
