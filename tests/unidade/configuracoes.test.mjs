// tests/unidade/configuracoes.test.mjs
import test from 'node:test';
import assert from 'node:assert';
import { CHAVES_CONFIGURACAO, validarConfiguracao } from '../../supabase/functions/_shared/configuracoes.mjs';

// Mesmos valores da migração 20261111000200_configuracoes_iniciais.sql.
const AGENDA_PADRAO = {
    antecedencia_minima_horas: 24, antecedencia_maxima_dias: 15, prazo_alteracao_horas: 24,
    duracao_maxima_individual: 3, duracao_maxima_grupo: 6, grupo_maximo: 15,
    faixas_instrutores: [{ ate: 5, instrutores: 1 }, { ate: 10, instrutores: 2 }, { ate: 15, instrutores: 3 }],
    poucas_vagas: 1, tolerancia_nao_comparecimento_min: 15,
};
const DIA = { abre: '08:00', fecha: '23:00' };
const DIAS_PADRAO = { 0: DIA, 1: DIA, 2: DIA, 3: DIA, 4: DIA, 5: DIA, 6: DIA };
const ESTANDE_PADRAO = { nome: 'RangePass', logo_url: null, endereco: '', contato: '', fuso: 'America/Sao_Paulo' };

test('CHAVES_CONFIGURACAO lista as sete chaves', () => {
    assert.deepStrictEqual(CHAVES_CONFIGURACAO, ['estande', 'funcionamento', 'agenda', 'municao', 'cadastro', 'creditos', 'privacidade']);
});

test('validarConfiguracao: todos os padrões iniciais são válidos', () => {
    assert.deepStrictEqual(validarConfiguracao('agenda', AGENDA_PADRAO), {});
    assert.deepStrictEqual(validarConfiguracao('funcionamento', { dias: DIAS_PADRAO, datas_fechadas: [] }), {});
    assert.deepStrictEqual(validarConfiguracao('estande', ESTANDE_PADRAO), {});
    assert.deepStrictEqual(validarConfiguracao('municao', { minima_por_participante: 50 }), {});
    assert.deepStrictEqual(validarConfiguracao('cadastro', { idade_minima: 18 }), {});
    assert.deepStrictEqual(validarConfiguracao('creditos', { validade_dias: 365, arrependimento_dias: 7 }), {});
});
test('validarConfiguracao: chave desconhecida', () => assert.ok(validarConfiguracao('xyz', {}).chave));
test('validarConfiguracao: valor que não é objeto', () => {
    assert.ok(validarConfiguracao('municao', 50).valor);
    assert.ok(validarConfiguracao('municao', null).valor);
    assert.ok(validarConfiguracao('municao', [50]).valor);
});
test('validarConfiguracao: antecedência máxima 0 é inválida', () => assert.ok(validarConfiguracao('agenda', { ...AGENDA_PADRAO, antecedencia_maxima_dias: 0 }).antecedencia_maxima_dias));
test('validarConfiguracao: antecedência mínima e tolerância aceitam 0', () => {
    assert.deepStrictEqual(validarConfiguracao('agenda', { ...AGENDA_PADRAO, antecedencia_minima_horas: 0, tolerancia_nao_comparecimento_min: 0 }), {});
});
test('validarConfiguracao: número negativo é inválido', () => assert.ok(validarConfiguracao('agenda', { ...AGENDA_PADRAO, antecedencia_minima_horas: -1 }).antecedencia_minima_horas));
test('validarConfiguracao: número com casas decimais é inválido', () => assert.ok(validarConfiguracao('municao', { minima_por_participante: 50.5 }).minima_por_participante));
test('validarConfiguracao: número em texto é inválido', () => assert.ok(validarConfiguracao('creditos', { validade_dias: '365', arrependimento_dias: 7 }).validade_dias));
test('validarConfiguracao: campo obrigatório faltando é inválido', () => assert.ok(validarConfiguracao('cadastro', {}).idade_minima));
test('validarConfiguracao: individual maior que grupo é inválido', () => assert.ok(validarConfiguracao('agenda', { ...AGENDA_PADRAO, duracao_maxima_individual: 7 }).duracao_maxima_individual));
test('validarConfiguracao: faixas fora de ordem', () => assert.ok(validarConfiguracao('agenda', { ...AGENDA_PADRAO, faixas_instrutores: [{ ate: 10, instrutores: 2 }, { ate: 5, instrutores: 1 }] }).faixas_instrutores));
test('validarConfiguracao: última faixa diferente do grupo máximo', () => assert.ok(validarConfiguracao('agenda', { ...AGENDA_PADRAO, faixas_instrutores: [{ ate: 5, instrutores: 1 }, { ate: 10, instrutores: 2 }] }).faixas_instrutores));
test('validarConfiguracao: faixa com zero instrutores', () => assert.ok(validarConfiguracao('agenda', { ...AGENDA_PADRAO, faixas_instrutores: [{ ate: 15, instrutores: 0 }] }).faixas_instrutores));
test('validarConfiguracao: abre depois de fechar', () => assert.ok(validarConfiguracao('funcionamento', { dias: { ...DIAS_PADRAO, 1: { abre: '23:00', fecha: '08:00' } }, datas_fechadas: [] })['dias.1']));
test('validarConfiguracao: horário em formato errado', () => assert.ok(validarConfiguracao('funcionamento', { dias: { ...DIAS_PADRAO, 2: { abre: '8h', fecha: '23:00' } }, datas_fechadas: [] })['dias.2']));
test('validarConfiguracao: dia da semana faltando', () => {
    const { 6: _sabado, ...semSabado } = DIAS_PADRAO;
    assert.ok(validarConfiguracao('funcionamento', { dias: semSabado, datas_fechadas: [] })['dias.6']);
});
test('validarConfiguracao: domingo fechado (null) é válido', () => assert.deepStrictEqual(validarConfiguracao('funcionamento', { dias: { ...DIAS_PADRAO, 0: null }, datas_fechadas: ['2026-12-25'] }), {}));
test('validarConfiguracao: data fechada inválida', () => assert.ok(validarConfiguracao('funcionamento', { dias: DIAS_PADRAO, datas_fechadas: ['25/12/2026'] }).datas_fechadas));
test('validarConfiguracao: nome do estande vazio', () => assert.ok(validarConfiguracao('estande', { ...ESTANDE_PADRAO, nome: '   ' }).nome));

// Correções da revisão final.
test('validarConfiguracao: estande sem fuso é inválido', () => {
    const { fuso: _fuso, ...semFuso } = ESTANDE_PADRAO;
    assert.ok(validarConfiguracao('estande', semFuso).fuso);
});
test('validarConfiguracao: fuso que não existe é inválido', () => assert.ok(validarConfiguracao('estande', { ...ESTANDE_PADRAO, fuso: 'Marte/Base' }).fuso));
test('validarConfiguracao: endereço, contato e logo precisam ser texto', () => {
    const erros = validarConfiguracao('estande', { ...ESTANDE_PADRAO, endereco: 5, contato: null, logo_url: 7 });
    assert.ok(erros.endereco);
    assert.ok(erros.contato);
    assert.ok(erros.logo_url);
});
test('validarConfiguracao: logo pode ser nulo ou endereço de imagem', () => {
    assert.deepStrictEqual(validarConfiguracao('estande', { ...ESTANDE_PADRAO, logo_url: 'https://exemplo.com/logo.png' }), {});
});
test('validarConfiguracao: grupo acima de 6 horas é inválido', () => {
    assert.ok(validarConfiguracao('agenda', { ...AGENDA_PADRAO, duracao_maxima_grupo: 7 }).duracao_maxima_grupo);
});
test('validarConfiguracao: arrependimento abaixo de 7 dias é inválido (CDC art. 49)', () => {
    assert.ok(validarConfiguracao('creditos', { validade_dias: 365, arrependimento_dias: 6 }).arrependimento_dias);
    assert.deepStrictEqual(validarConfiguracao('creditos', { validade_dias: 365, arrependimento_dias: 10 }), {});
});

test('validarConfiguracao: política de privacidade válida', () => {
    assert.deepStrictEqual(validarConfiguracao('privacidade', { versao: 2, texto: 'x' }), {});
});
test('validarConfiguracao: versão da política precisa ser inteiro maior que 0', () => {
    assert.ok(validarConfiguracao('privacidade', { versao: 0, texto: 'x' }).versao);
    assert.ok(validarConfiguracao('privacidade', { texto: 'x' }).versao);
});
test('validarConfiguracao: texto da política não pode ficar vazio', () => {
    assert.strictEqual(validarConfiguracao('privacidade', { versao: 1, texto: '  ' }).texto, 'Escreva o texto da política.');
    assert.strictEqual(validarConfiguracao('privacidade', { versao: 1 }).texto, 'Escreva o texto da política.');
});
