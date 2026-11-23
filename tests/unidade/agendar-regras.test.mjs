// tests/unidade/agendar-regras.test.mjs
import test from 'node:test';
import assert from 'node:assert';
import {
    descreverSessao, TEXTO_SITUACAO, modelosDaCategoria, municoesDoModelo, nomeDoCalibre, separarAgendamentos,
    armaDoParticipante, municaoDoParticipante, textoSemAlteracao, somarDias, doisDigitos, linhasDoPreco,
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

test('somarDias soma dias a uma data AAAA-MM-DD, virando o mês e o ano', () => {
    assert.strictEqual(somarDias('2026-11-16', 0), '2026-11-16');
    assert.strictEqual(somarDias('2026-11-16', 30), '2026-12-16');
    assert.strictEqual(somarDias('2026-12-31', 1), '2027-01-01');
    assert.strictEqual(somarDias('2028-02-28', 1), '2028-02-29');
});

test('doisDigitos completa com zero à esquerda', () => {
    assert.strictEqual(doisDigitos(7), '07');
    assert.strictEqual(doisDigitos(0), '00');
    assert.strictEqual(doisDigitos(12), '12');
});

test('textoSemAlteracao explica por que não dá para mexer no agendamento', () => {
    const agora = new Date('2026-11-16T15:00:00Z');
    const base = { inicio: '2026-11-16T20:00:00Z', horas: 2, situacao: 'pago', pode_alterar: false, prazo_alteracao_horas: 24 };

    assert.strictEqual(textoSemAlteracao({ ...base, pode_alterar: true }, agora), null);
    assert.strictEqual(textoSemAlteracao({ ...base, situacao: 'cancelado' }, agora), null);
    assert.strictEqual(
        textoSemAlteracao({ ...base, inicio: '2026-11-16T14:30:00Z', situacao: 'aguardando_pagamento' }, agora),
        'Sessão em andamento.',
    );
    assert.strictEqual(
        textoSemAlteracao(base, agora),
        'Faltam menos de 24 horas. Para alterar ou cancelar, fale com o estande.',
    );
    // Já terminou: nada a dizer.
    assert.strictEqual(textoSemAlteracao({ ...base, inicio: '2026-11-16T10:00:00Z' }, agora), null);
});

test('linhasDoPreco mostra cada item, o desconto e o total', () => {
    const preco = {
        itens: [
            { descricao: 'Pista (1 pista × 2 horas)', total_centavos: 24000 },
            { descricao: 'Aluguel de armas', total_centavos: 8000 },
            { descricao: 'Munição', total_centavos: 123456 },
        ],
        subtotal_centavos: 155456,
        desconto: { tipo: 'campanha', nome: 'Campanha Natal (10%)', valor_centavos: 15546 },
        total_centavos: 139910,
    };
    assert.deepStrictEqual(linhasDoPreco(preco), [
        { rotulo: 'Pista (1 pista × 2 horas)', valor: 'R$ 240,00' },
        { rotulo: 'Aluguel de armas', valor: 'R$ 80,00' },
        { rotulo: 'Munição', valor: 'R$ 1.234,56' },
        { rotulo: 'Campanha Natal (10%)', valor: '− R$ 155,46' },
        { rotulo: 'Total', valor: 'R$ 1.399,10' },
    ]);
});

test('linhasDoPreco sem desconto: só os itens e o total', () => {
    const preco = {
        itens: [{ descricao: 'Pista (2 pistas × 1 hora)', total_centavos: 20000 }],
        subtotal_centavos: 20000,
        desconto: null,
        total_centavos: 20000,
    };
    assert.deepStrictEqual(linhasDoPreco(preco), [
        { rotulo: 'Pista (2 pistas × 1 hora)', valor: 'R$ 200,00' },
        { rotulo: 'Total', valor: 'R$ 200,00' },
    ]);
});
