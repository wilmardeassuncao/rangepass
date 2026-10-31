const test = require('node:test');
const assert = require('node:assert');
const { interpretarResposta } = require('../regras.js');

test('ok com status ok é sucesso', () => {
    assert.equal(interpretarResposta(true, '{"status":"ok"}'), 'sucesso');
});

test('ok com status conflito é conflito', () => {
    assert.equal(interpretarResposta(true, '{"status":"conflito"}'), 'conflito');
});

test('Accepted padrão do Make é falha', () => {
    assert.equal(interpretarResposta(true, 'Accepted'), 'falha');
});

test('corpo vazio é falha', () => {
    assert.equal(interpretarResposta(true, ''), 'falha');
});

test('JSON com status desconhecido é falha', () => {
    assert.equal(interpretarResposta(true, '{"status":"x"}'), 'falha');
});

test('JSON null é falha', () => {
    assert.equal(interpretarResposta(true, 'null'), 'falha');
});

test('HTTP com erro é falha mesmo com corpo ok', () => {
    assert.equal(interpretarResposta(false, '{"status":"ok"}'), 'falha');
});
