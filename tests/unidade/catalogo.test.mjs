// tests/unidade/catalogo.test.mjs
import test from 'node:test';
import assert from 'node:assert';
import {
    TIPOS_CADASTRO, validarCadastroCatalogo, MENSAGENS_DUPLICADO, desativa,
} from '../../supabase/functions/_shared/catalogo.mjs';

const CRIAR = { criando: true };
const EDITAR = { criando: false };

test('TIPOS_CADASTRO lista os seis tipos', () => {
    assert.deepStrictEqual(TIPOS_CADASTRO, ['categoria', 'calibre', 'modelo', 'tipo_municao', 'unidade', 'pista']);
});

// Uma asserção por linha da tabela de mensagens.
test('tipo desconhecido', () => {
    assert.strictEqual(validarCadastroCatalogo('xyz', { nome: 'A' }, CRIAR).campos.tipo, 'Este tipo de cadastro não existe.');
});
test('campo que não existe no tipo', () => {
    assert.strictEqual(validarCadastroCatalogo('categoria', { cor: 'azul' }, EDITAR).campos.cor, 'Este campo não pode ser mudado aqui.');
});
test('campo que não muda, numa edição', () => {
    assert.strictEqual(validarCadastroCatalogo('modelo', { calibre_id: 2 }, EDITAR).campos.calibre_id, 'Este campo não pode ser mudado aqui.');
});
test('texto obrigatório vazio', () => {
    assert.strictEqual(validarCadastroCatalogo('categoria', { nome: '   ' }, CRIAR).campos.nome, 'Preencha este campo.');
});
test('*_id que não é inteiro > 0', () => {
    assert.strictEqual(validarCadastroCatalogo('unidade', { modelo_id: 0, numero_registro: 'X' }, CRIAR).campos.modelo_id, 'Escolha um item da lista.');
});
test('ativo/ativa que não é booleano', () => {
    assert.strictEqual(validarCadastroCatalogo('pista', { ativa: 'sim' }, EDITAR).campos.ativa, 'Escolha sim ou não.');
});
test('situacao fora da lista', () => {
    assert.strictEqual(validarCadastroCatalogo('unidade', { situacao: 'quebrada' }, EDITAR).campos.situacao, 'Escolha a situação da arma.');
});
test('numero que não é inteiro > 0', () => {
    assert.strictEqual(validarCadastroCatalogo('pista', { numero: 1.5 }, CRIAR).campos.numero, 'Informe um número inteiro maior que 0.');
});
test('edição sem nenhum campo', () => {
    assert.strictEqual(validarCadastroCatalogo('calibre', {}, EDITAR).campos.geral, 'Nada para alterar.');
});

test('obrigatórios ausentes ao criar', () => {
    const { campos } = validarCadastroCatalogo('modelo', {}, CRIAR);
    assert.deepStrictEqual(campos, {
        categoria_id: 'Escolha um item da lista.', calibre_id: 'Escolha um item da lista.',
        marca: 'Preencha este campo.', nome: 'Preencha este campo.',
    });
});

test('criação válida de cada tipo devolve valores com trim', () => {
    const casos = [
        ['categoria', { nome: '  Pistola ' }, { nome: 'Pistola' }],
        ['calibre', { nome: ' 9mm ', ativo: false }, { nome: '9mm', ativo: false }],
        ['modelo', { categoria_id: 1, calibre_id: 2, marca: ' Glock ', nome: ' G17 ' }, { categoria_id: 1, calibre_id: 2, marca: 'Glock', nome: 'G17' }],
        ['tipo_municao', { calibre_id: 2, nome: ' FMJ ' }, { calibre_id: 2, nome: 'FMJ' }],
        ['unidade', { modelo_id: 3, numero_registro: ' ABC-1 ', situacao: 'manutencao' }, { modelo_id: 3, numero_registro: 'ABC-1', situacao: 'manutencao' }],
        ['pista', { numero: 7, ativa: true }, { numero: 7, ativa: true }],
    ];
    for (const [tipo, dados, esperado] of casos) {
        const r = validarCadastroCatalogo(tipo, dados, CRIAR);
        assert.deepStrictEqual(r.campos, {}, tipo);
        assert.deepStrictEqual(r.valores, esperado, tipo);
    }
});

test('unidade sem situacao vale disponivel', () => {
    const r = validarCadastroCatalogo('unidade', { modelo_id: 3, numero_registro: 'X' }, CRIAR);
    assert.strictEqual(r.valores.situacao, 'disponivel');
});

test('edição válida devolve só as chaves enviadas', () => {
    const r = validarCadastroCatalogo('modelo', { categoria_id: 4, nome: ' Novo ' }, EDITAR);
    assert.deepStrictEqual(r, { campos: {}, valores: { categoria_id: 4, nome: 'Novo' } });
    const u = validarCadastroCatalogo('unidade', { numero_registro: ' R ' }, EDITAR);
    assert.deepStrictEqual(u.valores, { numero_registro: 'R' });
});

test('com erro, valores vem vazio', () => {
    assert.deepStrictEqual(validarCadastroCatalogo('categoria', { nome: '' }, CRIAR).valores, {});
});

test('dados que não são objeto contam como vazios', () => {
    assert.strictEqual(validarCadastroCatalogo('categoria', null, EDITAR).campos.geral, 'Nada para alterar.');
    assert.strictEqual(validarCadastroCatalogo('categoria', [1], CRIAR).campos.nome, 'Preencha este campo.');
});

// Preços: modelo (por hora de aluguel) e munição (por unidade), em centavos. null = sem preço.
test('preço do modelo e da munição: inteiro > 0 ou null, editável', () => {
    const casos = [['modelo', 'preco_hora_centavos'], ['tipo_municao', 'preco_unidade_centavos'], ['tipo_municao', 'custo_compra_centavos']];
    for (const [tipo, campo] of casos) {
        assert.deepStrictEqual(validarCadastroCatalogo(tipo, { [campo]: 4000 }, EDITAR), { campos: {}, valores: { [campo]: 4000 } }, tipo);
        assert.deepStrictEqual(validarCadastroCatalogo(tipo, { [campo]: null }, EDITAR), { campos: {}, valores: { [campo]: null } }, tipo);
        for (const ruim of [0, -1, 1.5, '4000', true]) {
            assert.strictEqual(validarCadastroCatalogo(tipo, { [campo]: ruim }, EDITAR).campos[campo],
                'Informe um valor maior que zero.', `${tipo} ${String(ruim)}`);
        }
    }
});

test('preço é opcional ao criar e entra quando enviado', () => {
    const sem = validarCadastroCatalogo('modelo', { categoria_id: 1, calibre_id: 2, marca: 'M', nome: 'N' }, CRIAR);
    assert.deepStrictEqual(sem.valores, { categoria_id: 1, calibre_id: 2, marca: 'M', nome: 'N' });
    const com = validarCadastroCatalogo('tipo_municao', { calibre_id: 2, nome: 'FMJ', preco_unidade_centavos: 350 }, CRIAR);
    assert.deepStrictEqual(com.valores, { calibre_id: 2, nome: 'FMJ', preco_unidade_centavos: 350 });
    // Os outros tipos não têm preço.
    assert.strictEqual(validarCadastroCatalogo('categoria', { preco_hora_centavos: 100 }, EDITAR).campos.preco_hora_centavos,
        'Este campo não pode ser mudado aqui.');
});

test('MENSAGENS_DUPLICADO tem um campo e uma mensagem por tipo', () => {
    assert.deepStrictEqual(MENSAGENS_DUPLICADO, {
        categoria: { nome: 'Já existe um cadastro com este nome.' },
        calibre: { nome: 'Já existe um cadastro com este nome.' },
        modelo: { nome: 'Já existe um modelo com esta marca e nome.' },
        tipo_municao: { nome: 'Já existe uma munição com este nome neste calibre.' },
        unidade: { numero_registro: 'Já existe uma arma com este número de registro.' },
        pista: { numero: 'Já existe uma pista com este número.' },
    });
});

test('desativa: unidade fora de disponivel e pista com ativa false', () => {
    assert.strictEqual(desativa('unidade', { situacao: 'manutencao' }), true);
    assert.strictEqual(desativa('unidade', { situacao: 'desativada' }), true);
    assert.strictEqual(desativa('unidade', { situacao: 'disponivel' }), false);
    assert.strictEqual(desativa('unidade', { numero_registro: 'X' }), false);
    assert.strictEqual(desativa('pista', { ativa: false }), true);
    assert.strictEqual(desativa('pista', { ativa: true }), false);
    assert.strictEqual(desativa('categoria', { ativo: false }), false);
});
