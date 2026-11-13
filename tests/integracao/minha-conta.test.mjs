// tests/integracao/minha-conta.test.mjs
import test, { after } from 'node:test';
import assert from 'node:assert';
import { rest, funcao, criarUsuario, apagarUsuariosCriados, banirUsuario } from './apoio.mjs';

const SESSAO_EXPIRADA = { erro: 'Sua sessão expirou. Entre de novo.' };

// Os testes apagam tudo o que criam.
after(apagarUsuariosCriados);

test('sem login recebe 401', async () => {
    const r = await funcao('minha-conta');
    assert.strictEqual(r.status, 401, JSON.stringify(r.dados));
    assert.deepStrictEqual(r.dados, SESSAO_EXPIRADA);
});

test('token inválido recebe 401 com mensagem clara', async () => {
    const r = await funcao('minha-conta', { token: 'token-que-nao-existe' });
    assert.strictEqual(r.status, 401, JSON.stringify(r.dados));
    assert.deepStrictEqual(r.dados, SESSAO_EXPIRADA);
});

test('cliente vê os próprios papéis', async () => {
    const u = await criarUsuario({ papeis: ['cliente'] });
    const r = await funcao('minha-conta', { token: u.token });
    assert.strictEqual(r.status, 200, JSON.stringify(r.dados));
    assert.deepStrictEqual(r.dados.papeis, ['cliente']);
    assert.strictEqual(r.dados.id, u.id);
    assert.strictEqual(r.dados.email, u.email);
    assert.strictEqual(r.dados.perfil.id, u.id);
});

test('usuário sem cadastro recebe perfil null', async () => {
    const u = await criarUsuario({ perfil: false });
    const r = await funcao('minha-conta', { token: u.token });
    assert.strictEqual(r.status, 200, JSON.stringify(r.dados));
    assert.strictEqual(r.dados.perfil, null);
    assert.deepStrictEqual(r.dados.papeis, []);
});

test('usuário desativado recebe 403 mesmo com token válido', async () => {
    const u = await criarUsuario({ papeis: ['cliente'] });
    const desativa = await rest(`perfis?id=eq.${u.id}`, { metodo: 'PATCH', corpo: { ativo: false } });
    assert.strictEqual(desativa.status, 200, JSON.stringify(desativa.dados));
    const r = await funcao('minha-conta', { token: u.token });
    assert.strictEqual(r.status, 403, JSON.stringify(r.dados));
    assert.deepStrictEqual(r.dados, { erro: 'Sua conta está desativada. Procure o atendimento do estande.' });
});

// Correção da revisão final: desativar = bloquear o login no Supabase Auth, com ou sem cadastro.
test('conta bloqueada sem cadastro recebe 403 mesmo com token válido', async () => {
    const u = await criarUsuario({ perfil: false, papeis: ['superadmin'] });
    await banirUsuario(u.id);
    const r = await funcao('minha-conta', { token: u.token });
    assert.strictEqual(r.status, 403, JSON.stringify(r.dados));
    assert.deepStrictEqual(r.dados, { erro: 'Sua conta está desativada. Procure o atendimento do estande.' });
});

// Plano 2: o cliente edita o próprio perfil pelo PUT.
const ATENDIMENTO = 'Para mudar este dado, procure o atendimento do estande.';

test('cliente altera telefone e CR e o histórico guarda o autor', async () => {
    const u = await criarUsuario({ papeis: ['cliente'] });
    const r = await funcao('minha-conta', { metodo: 'PUT', token: u.token, corpo: { telefone: '(11) 3456-7890', cr: ' 123 ' } });
    assert.strictEqual(r.status, 200, JSON.stringify(r.dados));
    assert.strictEqual(r.dados.perfil.telefone, '1134567890');
    assert.strictEqual(r.dados.perfil.cr, '123');

    const h = await rest(`historico_alteracoes?tabela=eq.perfis&registro_id=eq.${u.id}&acao=eq.alteracao&select=feito_por,depois&order=id.desc&limit=1`);
    assert.strictEqual(h.dados[0].feito_por, u.id);
    assert.strictEqual(h.dados[0].depois.telefone, '1134567890');
});

test('cliente não muda o CPF', async () => {
    const u = await criarUsuario({ papeis: ['cliente'] });
    const r = await funcao('minha-conta', { metodo: 'PUT', token: u.token, corpo: { cpf: '52998224725' } });
    assert.strictEqual(r.status, 400, JSON.stringify(r.dados));
    assert.strictEqual(r.dados.erro, 'Revise os campos destacados.');
    assert.strictEqual(r.dados.campos.cpf, ATENDIMENTO);
    const depois = await funcao('minha-conta', { token: u.token });
    assert.strictEqual(depois.dados.perfil.cpf, u.cpf);
});

test('telefone inválido recebe 400', async () => {
    const u = await criarUsuario({ papeis: ['cliente'] });
    const r = await funcao('minha-conta', { metodo: 'PUT', token: u.token, corpo: { telefone: '123' } });
    assert.strictEqual(r.status, 400, JSON.stringify(r.dados));
    assert.strictEqual(r.dados.campos.telefone, 'Informe o telefone com DDD.');
});

test('usuário sem cadastro recebe 404 no PUT', async () => {
    const u = await criarUsuario({ perfil: false });
    const r = await funcao('minha-conta', { metodo: 'PUT', token: u.token, corpo: { telefone: '1134567890' } });
    assert.strictEqual(r.status, 404, JSON.stringify(r.dados));
    assert.deepStrictEqual(r.dados, { erro: 'Não encontramos o seu cadastro. Procure o atendimento do estande.' });
});

test('sem login recebe 401 no PUT', async () => {
    const r = await funcao('minha-conta', { metodo: 'PUT', corpo: { telefone: '1134567890' } });
    assert.strictEqual(r.status, 401, JSON.stringify(r.dados));
    assert.deepStrictEqual(r.dados, SESSAO_EXPIRADA);
});

test('outros métodos recebem 405', async () => {
    const u = await criarUsuario({ papeis: ['cliente'] });
    const r = await funcao('minha-conta', { metodo: 'POST', token: u.token, corpo: {} });
    assert.strictEqual(r.status, 405, JSON.stringify(r.dados));
});
