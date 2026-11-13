// tests/unidade/cadastro.test.mjs
import test from 'node:test';
import assert from 'node:assert';
import {
    cpfValido, dataNoFuso, idadeEm, validarCadastro, validarEdicaoPerfil,
} from '../../supabase/functions/_shared/cadastro.mjs';

const VALIDO = {
    email: ' Ana@Exemplo.com ', senha: 'segredo123', nome_completo: '  Ana   Souza ', cpf: '529.982.247-25',
    telefone: '(11) 98765-4321', data_nascimento: '2000-05-10', cr: '', orgao_expedidor: ' SSP ', aceite_politica_versao: 1,
};
const OPCOES = { idadeMinima: 18, hoje: '2026-11-13', versaoPolitica: 1 };
const ATENDIMENTO = 'Para mudar este dado, procure o atendimento do estande.';

function campos(troca) {
    return validarCadastro({ ...VALIDO, ...troca }, OPCOES).campos;
}

test('cpfValido aceita CPF com e sem pontuação', () => {
    assert.strictEqual(cpfValido('52998224725'), true);
    assert.strictEqual(cpfValido('529.982.247-25'), true);
});

test('cpfValido recusa dígito errado, dígitos iguais, tamanho errado e vazio', () => {
    for (const cpf of ['52998224724', '111.111.111-11', '123', '', undefined]) {
        assert.strictEqual(cpfValido(cpf), false, String(cpf));
    }
});

test('dataNoFuso usa o fuso do estande, não o do aparelho', () => {
    assert.strictEqual(dataNoFuso(new Date('2026-11-14T02:30:00Z'), 'America/Sao_Paulo'), '2026-11-13');
});

test('idadeEm conta anos completos, inclusive 29 de fevereiro', () => {
    assert.strictEqual(idadeEm('2008-11-13', '2026-11-13'), 18);
    assert.strictEqual(idadeEm('2008-11-14', '2026-11-13'), 17);
    assert.strictEqual(idadeEm('2008-02-29', '2026-02-28'), 17);
    assert.strictEqual(idadeEm('2008-02-29', '2026-03-01'), 18);
});

test('validarCadastro aceita e normaliza um cadastro válido', () => {
    const r = validarCadastro(VALIDO, OPCOES);
    assert.deepStrictEqual(r.campos, {});
    assert.deepStrictEqual(r.conta, { email: 'ana@exemplo.com', senha: 'segredo123' });
    assert.deepStrictEqual(r.perfil, {
        nome_completo: 'Ana Souza', cpf: '52998224725', telefone: '11987654321',
        data_nascimento: '2000-05-10', cr: null, orgao_expedidor: 'SSP',
    });
});

test('validarCadastro explica cada campo inválido', () => {
    assert.strictEqual(campos({ email: 'ana@exemplo' }).email, 'Informe um e-mail válido.');
    assert.strictEqual(campos({ senha: '' }).senha, 'Crie uma senha.');
    assert.strictEqual(campos({ senha: 123 }).senha, 'Crie uma senha.');
    assert.strictEqual(campos({ nome_completo: 'Ana' }).nome_completo, 'Informe o nome completo.');
    assert.strictEqual(campos({ cpf: '111.111.111-11' }).cpf, 'Informe um CPF válido.');
    assert.strictEqual(campos({ telefone: '98765-4321' }).telefone, 'Informe o telefone com DDD.');
    assert.strictEqual(campos({ data_nascimento: '2000-02-30' }).data_nascimento, 'Informe a data de nascimento.');
    assert.strictEqual(campos({ data_nascimento: '10/05/2000' }).data_nascimento, 'Informe a data de nascimento.');
    assert.strictEqual(campos({ aceite_politica_versao: 0 }).aceite_politica_versao, 'Para criar a conta, aceite a política de privacidade.');
    assert.strictEqual(campos({ aceite_politica_versao: undefined }).aceite_politica_versao, 'Para criar a conta, aceite a política de privacidade.');
    assert.strictEqual(campos({ cr: 123 }).cr, 'Revise este campo.');
    assert.strictEqual(campos({ orgao_expedidor: true }).orgao_expedidor, 'Revise este campo.');
});

test('validarCadastro cobra a idade mínima no dia do aniversário', () => {
    assert.strictEqual(campos({ data_nascimento: '2008-11-14' }).data_nascimento, 'É preciso ter pelo menos 18 anos para criar uma conta.');
    assert.strictEqual(campos({ data_nascimento: '2008-11-13' }).data_nascimento, undefined);
    assert.strictEqual(campos({ data_nascimento: '2027-01-01' }).data_nascimento, 'Informe a data de nascimento.');
});

test('validarCadastro sem dados responde campo a campo, sem quebrar', () => {
    const r = validarCadastro(null, OPCOES);
    assert.ok(r.campos.email && r.campos.cpf && r.campos.aceite_politica_versao);
});

test('validarEdicaoPerfil normaliza os campos permitidos', () => {
    const r = validarEdicaoPerfil({ telefone: '11 3456-7890', cr: ' 123 ' });
    assert.deepStrictEqual(r.campos, {});
    assert.deepStrictEqual(r.alteracoes, { telefone: '1134567890', cr: '123' });
});

test('validarEdicaoPerfil manda CPF e nascimento para o atendimento', () => {
    assert.strictEqual(validarEdicaoPerfil({ cpf: '52998224725' }).campos.cpf, ATENDIMENTO);
    assert.strictEqual(validarEdicaoPerfil({ data_nascimento: '2000-01-01' }).campos.data_nascimento, ATENDIMENTO);
});

test('validarEdicaoPerfil recusa campo desconhecido, vazio e inválido', () => {
    assert.strictEqual(validarEdicaoPerfil({ apelido: 'x' }).campos.apelido, 'Este campo não existe.');
    assert.strictEqual(validarEdicaoPerfil({}).campos.geral, 'Nada para alterar.');
    assert.strictEqual(validarEdicaoPerfil(null).campos.geral, 'Nada para alterar.');
    assert.strictEqual(validarEdicaoPerfil({ telefone: '123' }).campos.telefone, 'Informe o telefone com DDD.');
    assert.strictEqual(validarEdicaoPerfil({ nome_completo: 'Ana' }).campos.nome_completo, 'Informe o nome completo.');
});

test('validarEdicaoPerfil deixa apagar o CR', () => {
    assert.deepStrictEqual(validarEdicaoPerfil({ cr: '' }).alteracoes, { cr: null });
    assert.deepStrictEqual(validarEdicaoPerfil({ cr: null }).alteracoes, { cr: null });
});
