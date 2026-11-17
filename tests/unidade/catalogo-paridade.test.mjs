// tests/unidade/catalogo-paridade.test.mjs
// Os formulários de cadastro da página da equipe (CAMPOS_FORMULARIO, usado pelo admin.js) e as
// regras do servidor (CAMPOS_CADASTRO) não podem se desencontrar: todo campo do formulário existe
// no servidor e "fixo" (só ao criar) é exatamente o contrário do "editavel" do servidor.
import test from 'node:test';
import assert from 'node:assert';
import { CAMPOS_CADASTRO, TIPOS_CADASTRO } from '../../supabase/functions/_shared/catalogo.mjs';
import { CAMPOS_FORMULARIO } from '../../admin-regras.mjs';

// Campos do servidor que de propósito não aparecem no formulário: ativo/ativa mudam pelo botão
// "Desativar"/"Reativar", o número da pista é escolhido sozinho (o próximo livre) e os preços da
// arma e da munição mudam na aba Preços.
const FORA_DO_FORMULARIO = {
    categoria: ['ativo'], calibre: ['ativo'], modelo: ['ativo', 'preco_hora_centavos'],
    tipo_municao: ['ativo', 'preco_unidade_centavos'], unidade: [], pista: ['numero', 'ativa'],
};

test('CAMPOS_CADASTRO tem um mapa para cada tipo de cadastro e não pode ser mudado', () => {
    assert.deepStrictEqual(Object.keys(CAMPOS_CADASTRO).sort(), [...TIPOS_CADASTRO].sort());
    assert.ok(Object.isFrozen(CAMPOS_CADASTRO));
    for (const tipo of TIPOS_CADASTRO) {
        assert.ok(Object.isFrozen(CAMPOS_CADASTRO[tipo]), tipo);
        for (const regra of Object.values(CAMPOS_CADASTRO[tipo])) assert.ok(Object.isFrozen(regra), tipo);
    }
});

test('o formulário de cada tipo mostra os campos do servidor (menos os que mudam por outro caminho)', () => {
    assert.deepStrictEqual(Object.keys(CAMPOS_FORMULARIO).sort(), [...TIPOS_CADASTRO].sort());
    for (const tipo of TIPOS_CADASTRO) {
        const doFormulario = CAMPOS_FORMULARIO[tipo].map((campo) => campo.nome).sort();
        const doServidor = Object.keys(CAMPOS_CADASTRO[tipo]).filter((nome) => !FORA_DO_FORMULARIO[tipo].includes(nome)).sort();
        assert.deepStrictEqual(doFormulario, doServidor, tipo);
    }
});

test('"fixo" no formulário é o contrário do "editavel" do servidor', () => {
    for (const tipo of TIPOS_CADASTRO) {
        for (const campo of CAMPOS_FORMULARIO[tipo]) {
            assert.strictEqual(campo.fixo, !CAMPOS_CADASTRO[tipo][campo.nome].editavel, `${tipo}.${campo.nome}`);
        }
    }
});

test('"soAoCriar" só vale para a situação da arma (que depois muda pela lista)', () => {
    const marcados = TIPOS_CADASTRO.flatMap((tipo) => CAMPOS_FORMULARIO[tipo].filter((c) => c.soAoCriar).map((c) => `${tipo}.${c.nome}`));
    assert.deepStrictEqual(marcados, ['unidade.situacao']);
    assert.strictEqual(CAMPOS_CADASTRO.unidade.situacao.editavel, true);
});
