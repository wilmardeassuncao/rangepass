// tests/unidade/agenda-regras.test.mjs
import test from 'node:test';
import assert from 'node:assert';
import { montarAgenda } from '../../agenda-regras.mjs';
import { somarDias } from '../../agendar-regras.mjs';

const FAIXAS = [{ ate: 5, instrutores: 1 }, { ate: 10, instrutores: 2 }, { ate: 15, instrutores: 3 }];
const ABERTO = { abre: '09:00', fecha: '18:00' };
const opcoes = {
    estande: { nome: 'Estande', fuso: 'America/Sao_Paulo' },
    agenda: {
        antecedencia_minima_horas: 24, antecedencia_maxima_dias: 15, prazo_alteracao_horas: 24,
        duracao_maxima_individual: 3, duracao_maxima_grupo: 6, grupo_maximo: 15,
        faixas_instrutores: FAIXAS, poucas_vagas: 1,
    },
    funcionamento: { dias: { 0: null, 1: ABERTO, 2: ABERTO, 3: ABERTO, 4: ABERTO, 5: ABERTO, 6: ABERTO }, datas_fechadas: [] },
};
// 2026-11-20 (sexta), meio-dia em Brasília. 2026-11-24 é terça.
const agora = new Date('2026-11-20T15:00:00Z');
const D = '2026-11-24';

const vaga = (pistas, instrutores) => ({ pistas, instrutores });
const contexto = (dias, extra = {}) => ({
    disponibilidade: { hoje: '2026-11-20', dias, agendamento: null }, opcoes, agora, quantidade: 1, instrutorId: null, ...extra,
});
const nada = { data: null, hora: null, horas: null };
const corDe = (ag, hora) => ag.horas.find((h) => h.hora === hora).cor;

test('hora com folga é livre, com uma vaga restante é poucas, sem vaga é lotado', () => {
    const ag = montarAgenda(contexto({
        [D]: { 10: vaga([1, 2, 3], ['a', 'b']), 11: vaga([1], ['a']), 12: vaga([], ['a']) },
    }), { ...nada, data: D });
    assert.strictEqual(corDe(ag, 10), 'livre');
    assert.strictEqual(corDe(ag, 11), 'poucas');
    assert.strictEqual(corDe(ag, 12), 'lotado');
    assert.strictEqual(ag.horas[0].rotulo, '10:00');
    assert.deepStrictEqual(ag.duracoes, []);
});

test('grupo de 6 precisa de 2 pistas e 2 instrutores', () => {
    const ok = montarAgenda(contexto({ [D]: { 10: vaga([1, 2, 3], ['a', 'b']) } }, { quantidade: 6 }), { ...nada, data: D });
    assert.strictEqual(corDe(ok, 10), 'poucas');
    const sem = montarAgenda(contexto({ [D]: { 10: vaga([1, 2, 3], ['a']), 15: vaga([1, 2, 3, 4], ['a', 'b', 'c']) } }, { quantidade: 6 }), { ...nada, data: D });
    assert.strictEqual(corDe(sem, 10), 'lotado');
});

test('vagas de grupo são pistas e instrutores livres divididos pelos necessários', () => {
    const p = (n) => Array.from({ length: n }, (_, i) => i + 1);
    const i4 = ['a', 'b', 'c', 'd'];
    const tres = montarAgenda(contexto({ [D]: { 10: vaga(p(3), i4.slice(0, 3)) } }, { quantidade: 6 }), { ...nada, data: D });
    assert.strictEqual(corDe(tres, 10), 'poucas');
    const quatro = montarAgenda(contexto({ [D]: { 10: vaga(p(4), i4) } }, { quantidade: 6 }), { ...nada, data: D });
    assert.strictEqual(corDe(quatro, 10), 'livre');
});

test('sessão de 2 horas com pista diferente livre em cada hora não cabe', () => {
    const ag = montarAgenda(contexto({
        [D]: { 10: vaga([1], ['a', 'b']), 11: vaga([2], ['a', 'b']) },
    }), { data: D, hora: 10, horas: null });
    assert.strictEqual(ag.duracoes[0].habilitada, true);
    assert.strictEqual(ag.duracoes[1].horas, 2);
    assert.strictEqual(ag.duracoes[1].habilitada, false);
});

test('instrutor escolhido ocupado deixa a hora lotada; sem preferência fica livre', () => {
    const dias = { [D]: { 10: vaga([1, 2, 3], ['a', 'b']), 15: vaga([1, 2, 3], ['a', 'b', 'c']) } };
    assert.strictEqual(corDe(montarAgenda(contexto(dias, { instrutorId: 'c' }), { ...nada, data: D }), 10), 'lotado');
    assert.strictEqual(corDe(montarAgenda(contexto(dias, { instrutorId: 'a' }), { ...nada, data: D }), 10), 'livre');
    assert.strictEqual(corDe(montarAgenda(contexto(dias), { ...nada, data: D }), 10), 'livre');
});

test('hora a menos da antecedência mínima é lotado, mesmo com vagas', () => {
    // 21/11 08:00 em Brasília = 11:00Z, 20h depois de "agora" (< 24h); 21/11 15:00 = 18:00Z, 27h depois.
    const ag = montarAgenda(contexto({ '2026-11-21': { 8: vaga([1, 2, 3], ['a', 'b']), 15: vaga([1, 2, 3], ['a', 'b']) } }),
        { ...nada, data: '2026-11-21' });
    assert.strictEqual(corDe(ag, 8), 'lotado');
    assert.strictEqual(corDe(ag, 15), 'livre');
});

test('duração que passa do fechamento não aparece; acima do máximo individual não aparece para 1 pessoa', () => {
    const cheio = vaga([1, 2, 3], ['a']);
    const dias = { [D]: { 10: cheio, 16: cheio, 17: cheio } };
    const um = montarAgenda(contexto(dias), { data: D, hora: 10, horas: null });
    assert.deepStrictEqual(um.duracoes.map((d) => d.horas), [1, 2, 3]);
    const fim = montarAgenda(contexto(dias), { data: D, hora: 17, horas: null });
    assert.deepStrictEqual(fim.duracoes.map((d) => d.horas), [1]);
    const grupo = montarAgenda(contexto(dias, { quantidade: 2 }), { data: D, hora: 10, horas: null });
    assert.deepStrictEqual(grupo.duracoes.map((d) => d.horas), [1, 2, 3, 4, 5, 6]);
});

test('rótulos dos dias e das durações', () => {
    const dias = { [D]: { 10: vaga([1], ['a']), 11: vaga([1], ['a']) }, '2026-11-22': {} };
    const ag = montarAgenda(contexto(dias), { data: D, hora: 10, horas: null });
    assert.strictEqual(ag.dias[1].rotulo, 'Ter 24/11');
    assert.strictEqual(ag.dias[0].rotulo, 'Dom 22/11');
    assert.deepStrictEqual(ag.duracoes[0], { horas: 1, rotulo: '1 hora', ate: '11:00', habilitada: true });
    assert.strictEqual(ag.duracoes[1].rotulo, '2 horas');
    assert.strictEqual(ag.duracoes[1].ate, '12:00');
});

test('dia fechado ou sem nenhuma hora livre fica desabilitado', () => {
    const ag = montarAgenda(contexto({
        '2026-11-22': {},
        '2026-11-23': { 10: vaga([], ['a']) },
        [D]: { 10: vaga([1], ['a']) },
    }), nada);
    assert.deepStrictEqual(ag.dias.map((d) => d.habilitado), [false, false, true]);
    assert.deepStrictEqual(ag.horas, []);
});

test('escolha que deixou de caber é desfeita com o aviso certo', () => {
    const dias = {
        [D]: { 10: vaga([1], ['a']), 11: vaga([], ['a']) },
        '2026-11-25': { 10: vaga([1], ['a']), 11: vaga([2], ['a']) },
    };
    const dia = montarAgenda(contexto({ [D]: { 10: vaga([], []) } }), { data: D, hora: 10, horas: 1 });
    assert.deepStrictEqual(dia.escolha, nada);
    assert.strictEqual(dia.aviso, 'O dia escolhido não tem mais horário livre para este grupo. Escolha outro dia.');
    const hora = montarAgenda(contexto(dias), { data: D, hora: 11, horas: 1 });
    assert.deepStrictEqual(hora.escolha, { data: D, hora: null, horas: null });
    assert.strictEqual(hora.aviso, 'O horário escolhido não está mais livre para este grupo. Escolha outro.');
    const dur = montarAgenda(contexto(dias), { data: '2026-11-25', hora: 10, horas: 2 });
    assert.deepStrictEqual(dur.escolha, { data: '2026-11-25', hora: 10, horas: null });
    assert.strictEqual(dur.aviso, 'A duração escolhida não cabe mais neste horário. Escolha outra.');
    const ok = montarAgenda(contexto(dias), { data: D, hora: 10, horas: 1 });
    assert.strictEqual(ok.aviso, null);
});

test('resumo', () => {
    const dias = { [D]: { 10: vaga([1], ['a']), 11: vaga([1], ['a']) } };
    const ag = montarAgenda(contexto(dias), { data: D, hora: 10, horas: 2 });
    assert.strictEqual(ag.resumo, 'Terça, 24/11 · das 10:00 às 12:00');
    assert.strictEqual(montarAgenda(contexto(dias), { data: D, hora: 10, horas: null }).resumo, null);
});

test('somarDias é reexportada do módulo compartilhado', () => {
    assert.strictEqual(somarDias('2026-11-30', 1), '2026-12-01');
});
