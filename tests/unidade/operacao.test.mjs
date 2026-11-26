// tests/unidade/operacao.test.mjs
import test from 'node:test';
import assert from 'node:assert';
import {
    FORMAS_PAGAMENTO, ROTULO_FORMA, motivoSemCheckIn, validarCheckIn,
} from '../../supabase/functions/_shared/operacao.mjs';

const FUSO = 'America/Sao_Paulo'; // UTC-3
const HOJE = '2026-11-26';
const CTX = { hoje: HOJE, fuso: FUSO };

test('formas de pagamento e rótulos', () => {
    assert.deepStrictEqual(FORMAS_PAGAMENTO, ['dinheiro', 'pix', 'cartao_debito', 'cartao_credito']);
    assert.deepStrictEqual(ROTULO_FORMA, {
        dinheiro: 'Dinheiro', pix: 'Pix', cartao_debito: 'Cartão de débito', cartao_credito: 'Cartão de crédito',
    });
});

const NO_DIA = '2026-11-26T15:00:00.000Z';
test('motivoSemCheckIn: situações sem check-in', () => {
    assert.strictEqual(motivoSemCheckIn({ situacao: 'check_in', inicio: NO_DIA }, CTX),
        'O check-in deste agendamento já foi feito.');
    assert.strictEqual(motivoSemCheckIn({ situacao: 'concluido', inicio: NO_DIA }, CTX),
        'O check-in deste agendamento já foi feito.');
    assert.strictEqual(motivoSemCheckIn({ situacao: 'cancelado', inicio: NO_DIA }, CTX),
        'Este agendamento foi cancelado.');
    assert.strictEqual(motivoSemCheckIn({ situacao: 'nao_compareceu', inicio: NO_DIA }, CTX),
        'Este agendamento foi marcado como não compareceu.');
});
test('motivoSemCheckIn: situações que permitem', () => {
    assert.strictEqual(motivoSemCheckIn({ situacao: 'pago', inicio: NO_DIA }, CTX), null);
    assert.strictEqual(motivoSemCheckIn({ situacao: 'aguardando_pagamento', inicio: NO_DIA }, CTX), null);
});
test('motivoSemCheckIn: só no dia da sessão, no fuso', () => {
    // 23h30 de hoje em São Paulo = 02h30 UTC de amanhã
    assert.strictEqual(motivoSemCheckIn({ situacao: 'pago', inicio: '2026-11-27T02:30:00.000Z' }, CTX), null);
    // 00h30 de amanhã em São Paulo = 03h30 UTC de amanhã
    assert.strictEqual(motivoSemCheckIn({ situacao: 'pago', inicio: '2026-11-27T03:30:00.000Z' }, CTX),
        'O check-in só pode ser feito no dia da sessão.');
});

const AGUARDANDO = { situacao: 'aguardando_pagamento', temPreco: true };

test('validarCheckIn: pago aceita só {}', () => {
    assert.deepStrictEqual(validarCheckIn({}, { situacao: 'pago', temPreco: true }),
        { campos: {}, valores: { pagamento: null } });
    assert.strictEqual(validarCheckIn({ forma_pagamento: 'pix' }, { situacao: 'pago', temPreco: true })
        .campos.forma_pagamento, 'Este campo não pode ser mudado aqui.');
});
test('validarCheckIn: forma de pagamento obrigatória e conferida', () => {
    assert.strictEqual(validarCheckIn({ valor_esperado_centavos: 100 }, AGUARDANDO).campos.forma_pagamento,
        'Escolha a forma de pagamento.');
    assert.strictEqual(validarCheckIn({ forma_pagamento: 'cheque', valor_esperado_centavos: 100 }, AGUARDANDO)
        .campos.forma_pagamento, 'Escolha a forma de pagamento.');
});
test('validarCheckIn: com preço e sem classe', () => {
    assert.deepStrictEqual(validarCheckIn({ forma_pagamento: 'pix', valor_esperado_centavos: 25500 }, AGUARDANDO),
        { campos: {}, valores: { pagamento: { forma_pagamento: 'pix', classe_id: null, documento: null,
            valor_esperado_centavos: 25500 } } });
});
test('validarCheckIn: com preço, valor esperado obrigatório e inteiro >= 0', () => {
    assert.strictEqual(validarCheckIn({ forma_pagamento: 'pix' }, AGUARDANDO).campos.valor_esperado_centavos,
        'Informe o valor cobrado.');
    assert.strictEqual(validarCheckIn({ forma_pagamento: 'pix', valor_esperado_centavos: -1 }, AGUARDANDO)
        .campos.valor_esperado_centavos, 'Informe o valor cobrado.');
    assert.deepStrictEqual(validarCheckIn({ forma_pagamento: 'pix', valor_esperado_centavos: 0 }, AGUARDANDO).campos, {});
});
test('validarCheckIn: classe exige documento', () => {
    const base = { forma_pagamento: 'dinheiro', valor_esperado_centavos: 100, classe_id: 3 };
    assert.strictEqual(validarCheckIn(base, AGUARDANDO).campos.documento,
        'Informe o número do documento conferido.');
    assert.strictEqual(validarCheckIn({ ...base, documento: '   ' }, AGUARDANDO).campos.documento,
        'Informe o número do documento conferido.');
    assert.strictEqual(validarCheckIn({ ...base, documento: 'x'.repeat(61) }, AGUARDANDO).campos.documento,
        'Use no máximo 60 caracteres.');
    assert.deepStrictEqual(validarCheckIn({ ...base, documento: ' 123 ' }, AGUARDANDO),
        { campos: {}, valores: { pagamento: { forma_pagamento: 'dinheiro', classe_id: 3, documento: '123',
            valor_esperado_centavos: 100 } } });
});
test('validarCheckIn: chave desconhecida em aguardando_pagamento', () => {
    const r = validarCheckIn({ forma_pagamento: 'pix', valor_esperado_centavos: 100, desconto: 10 }, AGUARDANDO);
    assert.strictEqual(r.campos.desconto, 'Este campo não pode ser mudado aqui.');
});
test('validarCheckIn: classe_id inválido', () => {
    for (const classe_id of [0, '3']) {
        const r = validarCheckIn({ forma_pagamento: 'pix', valor_esperado_centavos: 100, classe_id, documento: '1' },
            AGUARDANDO);
        assert.strictEqual(r.campos.classe_id, 'Escolha um item da lista.');
    }
});
test('validarCheckIn: sem preço guardado', () => {
    const SEM = { situacao: 'aguardando_pagamento', temPreco: false };
    assert.strictEqual(validarCheckIn({ forma_pagamento: 'pix', classe_id: 3, documento: '1', valor_centavos: 100 }, SEM)
        .campos.classe_id, 'Este agendamento não tem preço guardado: o desconto de classe não está disponível.');
    assert.strictEqual(validarCheckIn({ forma_pagamento: 'pix' }, SEM).campos.valor_centavos,
        'Informe o valor cobrado.');
    assert.deepStrictEqual(validarCheckIn({ forma_pagamento: 'pix', valor_centavos: 9000 }, SEM),
        { campos: {}, valores: { pagamento: { forma_pagamento: 'pix', classe_id: null, documento: null,
            valor_centavos: 9000 } } });
});
