// tests/unidade/agendar-regras.test.mjs
import test from 'node:test';
import assert from 'node:assert';
import {
    descreverSessao, TEXTO_SITUACAO, modelosDaCategoria, municoesDoModelo, nomeDoCalibre, separarAgendamentos,
    armaDoParticipante, municaoDoParticipante,
} from '../../agendar-regras.mjs';

test('descreverSessao mostra o dia e as horas no fuso do estande', () => {
    assert.strictEqual(descreverSessao('2026-11-18T13:00:00Z', 2, 'America/Sao_Paulo'), 'Quarta, 18/11 · das 10:00 às 12:00');
    assert.strictEqual(descreverSessao('2026-11-18T13:00:00Z', 2, 'America/New_York'), 'Quarta, 18/11 · das 08:00 às 10:00');
});

test('TEXTO_SITUACAO tem um texto para cada situação', () => {
    assert.strictEqual(TEXTO_SITUACAO.aguardando_pagamento, 'Aguardando pagamento');
    assert.strictEqual(TEXTO_SITUACAO.pago, 'Pago');
    assert.strictEqual(TEXTO_SITUACAO.check_in, 'Check-in feito');
    assert.strictEqual(TEXTO_SITUACAO.concluido, 'Concluído');
    assert.strictEqual(TEXTO_SITUACAO.cancelado, 'Cancelado');
    assert.strictEqual(TEXTO_SITUACAO.nao_compareceu, 'Não compareceu');
});

const CATALOGO = {
    categorias: [{ id: 'cat-pistola', nome: 'Pistola' }, { id: 'cat-rifle', nome: 'Rifle' }],
    calibres: [{ id: 'cal-9', nome: '9mm' }, { id: 'cal-22', nome: '.22 LR' }],
    modelos: [
        { id: 'm-taurus', categoria_id: 'cat-pistola', calibre_id: 'cal-9', marca: 'Taurus', nome: 'G2C' },
        { id: 'm-ruger', categoria_id: 'cat-rifle', calibre_id: 'cal-22', marca: 'Ruger', nome: '10/22' },
        { id: 'm-glock', categoria_id: 'cat-pistola', calibre_id: 'cal-9', marca: 'Glock', nome: 'G17' },
        { id: 'm-beretta', categoria_id: 'cat-pistola', calibre_id: 'cal-22', marca: 'Beretta', nome: '87' },
    ],
    tipos_municao: [
        { id: 't-9-ogival', calibre_id: 'cal-9', nome: 'Ogival' },
        { id: 't-22', calibre_id: 'cal-22', nome: 'Chumbo' },
        { id: 't-9-ponta-oca', calibre_id: 'cal-9', nome: 'Ponta oca' },
    ],
};

test('modelosDaCategoria devolve só os da categoria, em ordem de marca e nome', () => {
    assert.deepStrictEqual(modelosDaCategoria(CATALOGO, 'cat-pistola').map((m) => m.id), ['m-beretta', 'm-glock', 'm-taurus']);
    assert.deepStrictEqual(modelosDaCategoria(CATALOGO, 'cat-rifle').map((m) => m.id), ['m-ruger']);
    assert.deepStrictEqual(modelosDaCategoria(CATALOGO, 'nenhuma'), []);
});

test('municoesDoModelo devolve só as do calibre do modelo', () => {
    assert.deepStrictEqual(municoesDoModelo(CATALOGO, 'm-glock').map((t) => t.id), ['t-9-ogival', 't-9-ponta-oca']);
    assert.deepStrictEqual(municoesDoModelo(CATALOGO, 'm-beretta').map((t) => t.id), ['t-22']);
    assert.deepStrictEqual(municoesDoModelo(CATALOGO, 'nenhum'), []);
});

test('nomeDoCalibre devolve o nome do calibre do modelo', () => {
    assert.strictEqual(nomeDoCalibre(CATALOGO, 'm-ruger'), '.22 LR');
    assert.strictEqual(nomeDoCalibre(CATALOGO, 'm-taurus'), '9mm');
    assert.strictEqual(nomeDoCalibre(CATALOGO, 'nenhum'), '');
});

test('separarAgendamentos separa próximos e anteriores', () => {
    const agora = new Date('2026-11-16T15:00:00Z');
    const futuroPago = { id: 'futuro-pago', inicio: '2026-11-20T13:00:00Z', horas: 2, situacao: 'pago' };
    const futuroCancelado = { id: 'futuro-cancelado', inicio: '2026-11-21T13:00:00Z', horas: 1, situacao: 'cancelado' };
    const passado = { id: 'passado', inicio: '2026-11-10T13:00:00Z', horas: 1, situacao: 'concluido' };
    const emAndamento = { id: 'em-andamento', inicio: '2026-11-16T14:30:00Z', horas: 1, situacao: 'check_in' };

    const { proximos, anteriores } = separarAgendamentos([passado, futuroPago, emAndamento, futuroCancelado], agora);
    assert.deepStrictEqual(proximos.map((a) => a.id), ['em-andamento', 'futuro-pago']);
    assert.deepStrictEqual(anteriores.map((a) => a.id), ['futuro-cancelado', 'passado']);
});

test('armaDoParticipante descreve a arma do estande ou a própria', () => {
    assert.strictEqual(
        armaDoParticipante({ modalidade: 'estande', modelo: { marca: 'Glock', nome: 'G17', calibre: '9mm' }, arma_propria: null }),
        'Glock G17 (9mm), do estande',
    );
    assert.strictEqual(
        armaDoParticipante({ modalidade: 'estande', modelo: { marca: 'Glock', nome: 'G17', calibre: null }, arma_propria: null }),
        'Glock G17, do estande',
    );
    assert.strictEqual(
        armaDoParticipante({ modalidade: 'arma_propria', modelo: null, arma_propria: { modelo: 'Taurus TH9', calibre: '9mm' } }),
        'Taurus TH9 (9mm), arma própria',
    );
    assert.strictEqual(armaDoParticipante({ modalidade: 'tudo_proprio', modelo: null, arma_propria: null }), 'Arma própria');
});

test('municaoDoParticipante mostra a quantidade e o tipo, ou "Própria"', () => {
    assert.strictEqual(
        municaoDoParticipante({ modalidade: 'estande', tipo_municao: { nome: 'FMJ', calibre: '9mm' }, municao_qtd: 50 }),
        '50 × FMJ (9mm)',
    );
    assert.strictEqual(
        municaoDoParticipante({ modalidade: 'arma_propria', tipo_municao: { nome: 'FMJ', calibre: null }, municao_qtd: 50 }),
        '50 × FMJ',
    );
    assert.strictEqual(municaoDoParticipante({ modalidade: 'tudo_proprio', tipo_municao: null, municao_qtd: null }), 'Própria');
});
