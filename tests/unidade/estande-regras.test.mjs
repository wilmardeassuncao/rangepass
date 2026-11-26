import test from 'node:test';
import assert from 'node:assert/strict';
import { AREAS_ESTANDE, areasVisiveis } from '../../estande-areas.mjs';
import * as regras from '../../estande-regras.mjs';
import {
    ROTULO_SITUACAO, podeAbrirFicha, textoDoHorario, textoDasPistas, textoDaLista,
    textoDoValor, dataBrasileira, usoDoParticipante, contaDaFicha, valorACobrarCentavos, linhasDaConta,
    avisosDaConta, corpoDoCheckIn,
} from '../../estande-regras.mjs';

// O exemplo da spec 6.1: pista 100,00, aluguel 30,00 e munição 125,00; classe 20% / 10% / 15%.
const PRECO = {
    itens: [
        { descricao: 'Pista (1 pista × 1 hora)', total_centavos: 10000 },
        { descricao: 'Aluguel de armas', total_centavos: 3000 },
        { descricao: 'Munição', total_centavos: 12500 },
    ],
    subtotal_centavos: 25500,
    desconto: null,
    total_centavos: 25500,
};
const CLASSE = { id: 7, nome: 'Policial', percentual_pista: 20, percentual_aluguel: 10, percentual_municao: 15 };

function ficha({ situacao = 'aguardando_pagamento', preco = PRECO, custo = null } = {}) {
    return {
        agendamento: {
            id: 'a1', situacao, preco_detalhe: preco, preco_total_centavos: preco?.total_centavos ?? null,
        },
        classes: [CLASSE],
        custo_municao_centavos: custo,
        pode_fazer_check_in: true,
        motivo: null,
    };
}

test('AREAS_ESTANDE tem só a Recepção neste plano', () => {
    assert.deepEqual(AREAS_ESTANDE, [{ id: 'recepcao', texto: 'Recepção', papeis: ['atendente'] }]);
});

test('estande-regras reexporta as áreas de estande-areas', () => {
    assert.equal(regras.AREAS_ESTANDE, AREAS_ESTANDE);
    assert.equal(regras.areasVisiveis, areasVisiveis);
});

test('areasVisiveis: atendente e superadmin veem a Recepção; instrutor não vê nada', () => {
    assert.deepEqual(areasVisiveis(['atendente']), ['recepcao']);
    assert.deepEqual(areasVisiveis(['superadmin']), ['recepcao']);
    assert.deepEqual(areasVisiveis(['instrutor']), []);
    assert.deepEqual(areasVisiveis(['cliente', 'administrativo']), []);
});

test('ROTULO_SITUACAO tem os textos da Recepção', () => {
    assert.deepEqual(ROTULO_SITUACAO, {
        aguardando_pagamento: 'Aguardando check-in',
        pago: 'Pago pelo app',
        check_in: 'Check-in feito',
        concluido: 'Concluído',
        nao_compareceu: 'Não compareceu',
    });
});

test('podeAbrirFicha: só aguardando_pagamento e pago', () => {
    assert.equal(podeAbrirFicha('aguardando_pagamento'), true);
    assert.equal(podeAbrirFicha('pago'), true);
    for (const s of ['check_in', 'concluido', 'nao_compareceu', 'cancelado']) assert.equal(podeAbrirFicha(s), false, s);
});

test('textoDoHorario: das HH:MM às HH:MM no fuso do estande', () => {
    assert.equal(textoDoHorario('2026-11-26T11:00:00Z', 2, 'America/Sao_Paulo'), '08:00 às 10:00');
    assert.equal(textoDoHorario('2026-11-26T22:30:00Z', 1, 'America/Sao_Paulo'), '19:30 às 20:30');
});

test('textoDasPistas e textoDaLista', () => {
    assert.equal(textoDasPistas([3]), 'Pista 3');
    assert.equal(textoDasPistas([1, 2]), 'Pistas 1 e 2');
    assert.equal(textoDasPistas([1, 2, 4]), 'Pistas 1, 2 e 4');
    assert.equal(textoDasPistas([]), '—');
    assert.equal(textoDaLista(['Ana', 'Bruno']), 'Ana, Bruno');
    assert.equal(textoDaLista([]), '—');
});

test('textoDoValor: o valor do agendamento, o pago no balcão (com a nota) ou traço', () => {
    assert.deepEqual(textoDoValor({ valor_centavos: 25500, pago_no_balcao_centavos: null }), { valor: 'R$ 255,00', nota: null });
    assert.deepEqual(textoDoValor({ valor_centavos: 25500, pago_no_balcao_centavos: 21325 }), { valor: 'R$ 213,25', nota: 'pago no balcão' });
    assert.deepEqual(textoDoValor({ valor_centavos: null, pago_no_balcao_centavos: null }), { valor: '—', nota: null });
    assert.deepEqual(textoDoValor({ valor_centavos: null, pago_no_balcao_centavos: 0 }), { valor: 'R$ 0,00', nota: 'pago no balcão' });
});

test('dataBrasileira', () => {
    assert.equal(dataBrasileira('1990-01-31'), '31/01/1990');
    assert.equal(dataBrasileira(null), '—');
});

test('usoDoParticipante: arma e munição de cada modalidade', () => {
    assert.deepEqual(usoDoParticipante({ modalidade: 'estande', modelo: 'Taurus G2C', tipo_municao: '9mm', municao_qtd: 50 }),
        { arma: 'Taurus G2C, do estande', municao: '50 × 9mm' });
    assert.deepEqual(usoDoParticipante({ modalidade: 'arma_propria', modelo: null, tipo_municao: '.380', municao_qtd: 20 }),
        { arma: 'Arma própria', municao: '20 × .380' });
    assert.deepEqual(usoDoParticipante({ modalidade: 'tudo_proprio', modelo: null, tipo_municao: null, municao_qtd: null }),
        { arma: 'Arma própria', municao: 'Própria' });
});

test('contaDaFicha: sem classe ou sem preço não há conta; com classe, a conta da spec', () => {
    assert.equal(contaDaFicha(ficha(), ''), null);
    assert.equal(contaDaFicha(ficha({ preco: null }), '7'), null);
    assert.equal(contaDaFicha(ficha(), '999'), null);
    const conta = contaDaFicha(ficha(), '7');
    assert.equal(conta.valor_cobrado_centavos, 21325);
    assert.equal(conta.limitado_ao_custo, false);
});

test('valorACobrarCentavos: com conta, o cobrado; sem conta, o congelado; sem preço, null', () => {
    assert.equal(valorACobrarCentavos(ficha(), null), 25500);
    assert.equal(valorACobrarCentavos(ficha(), contaDaFicha(ficha(), '7')), 21325);
    assert.equal(valorACobrarCentavos(ficha({ preco: null }), null), null);
});

test('linhasDaConta: o exemplo da spec 6.1', () => {
    const conta = contaDaFicha(ficha(), '7');
    assert.deepEqual(linhasDaConta(conta, PRECO), [
        { rotulo: 'Pista', antes: 'R$ 100,00', desconto: '20%', depois: 'R$ 80,00', tipo: 'parte' },
        { rotulo: 'Aluguel de armas', antes: 'R$ 30,00', desconto: '10%', depois: 'R$ 27,00', tipo: 'parte' },
        { rotulo: 'Munição', antes: 'R$ 125,00', desconto: '15%', depois: 'R$ 106,25', tipo: 'parte' },
        { rotulo: 'Total', antes: 'R$ 255,00', desconto: '', depois: 'R$ 213,25', tipo: 'total' },
        { rotulo: 'Valor a cobrar', antes: '', desconto: '', depois: 'R$ 213,25', tipo: 'cobrar' },
    ]);
});

test('linhasDaConta: com pacote ou campanha aparece o valor do agendamento', () => {
    const comCampanha = { ...PRECO, desconto: { tipo: 'campanha', nome: 'Campanha Natal (20%)', valor_centavos: 5500 }, total_centavos: 20000 };
    const f = ficha({ preco: comCampanha });
    const linhas = linhasDaConta(contaDaFicha(f, '7'), comCampanha);
    assert.deepEqual(linhas.slice(-2), [
        { rotulo: 'Valor do agendamento (Campanha Natal (20%))', antes: '', desconto: '', depois: 'R$ 200,00', tipo: 'congelado' },
        { rotulo: 'Valor a cobrar', antes: '', desconto: '', depois: 'R$ 200,00', tipo: 'cobrar' },
    ]);
});

test('avisosDaConta: limite do custo e preço do agendamento menor', () => {
    assert.deepEqual(avisosDaConta(null), []);
    assert.deepEqual(avisosDaConta(contaDaFicha(ficha(), '7')), []);
    // Custo 11000: a munição fica em 110,00 em vez de 106,25.
    const limitada = contaDaFicha(ficha({ custo: 11000 }), '7');
    assert.equal(limitada.valor_cobrado_centavos, 21700);
    assert.deepEqual(avisosDaConta(limitada), ['Desconto da munição limitado ao custo de compra.']);
    const comCampanha = { ...PRECO, desconto: { tipo: 'campanha', nome: 'Campanha', valor_centavos: 5500 }, total_centavos: 20000 };
    assert.deepEqual(avisosDaConta(contaDaFicha(ficha({ preco: comCampanha, custo: 11000 }), '7')), [
        'Desconto da munição limitado ao custo de compra.',
        'O preço do agendamento já é menor que com este desconto.',
    ]);
});

test('corpoDoCheckIn: pago manda só a ação e o id', () => {
    assert.deepEqual(corpoDoCheckIn(ficha({ situacao: 'pago' }), { forma_pagamento: 'pix', classe_id: '7' }),
        { corpo: { acao: 'check_in', id: 'a1' }, campos: {} });
});

test('corpoDoCheckIn: sem classe manda o valor congelado como esperado', () => {
    assert.deepEqual(corpoDoCheckIn(ficha(), { forma_pagamento: 'dinheiro', classe_id: '', documento: 'x' }), {
        corpo: {
            acao: 'check_in', id: 'a1', forma_pagamento: 'dinheiro', classe_id: null, documento: null,
            valor_esperado_centavos: 25500,
        },
        campos: {},
    });
});

test('corpoDoCheckIn: com classe manda a classe, o documento sem espaços e o valor da conta', () => {
    assert.deepEqual(corpoDoCheckIn(ficha({ custo: 11000 }), { forma_pagamento: 'pix', classe_id: '7', documento: '  CR 123 ' }), {
        corpo: {
            acao: 'check_in', id: 'a1', forma_pagamento: 'pix', classe_id: 7, documento: 'CR 123',
            valor_esperado_centavos: 21700,
        },
        campos: {},
    });
});

test('corpoDoCheckIn: sem preço guardado manda o valor digitado (e nunca a classe)', () => {
    assert.deepEqual(corpoDoCheckIn(ficha({ preco: null }), { forma_pagamento: 'cartao_debito', classe_id: '7', valor_texto: '150,50' }), {
        corpo: {
            acao: 'check_in', id: 'a1', forma_pagamento: 'cartao_debito', classe_id: null, documento: null,
            valor_centavos: 15050,
        },
        campos: {},
    });
    assert.deepEqual(corpoDoCheckIn(ficha({ preco: null }), { forma_pagamento: 'pix', valor_texto: '' }).campos,
        { valor_centavos: 'Informe o valor cobrado.' });
    assert.deepEqual(corpoDoCheckIn(ficha({ preco: null }), { forma_pagamento: 'pix', valor_texto: 'abc' }).campos,
        { valor_centavos: 'Use um valor em reais, por exemplo 120,00.' });
});
