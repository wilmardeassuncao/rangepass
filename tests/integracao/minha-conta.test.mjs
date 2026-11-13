// tests/integracao/minha-conta.test.mjs
import test, { after } from 'node:test';
import assert from 'node:assert';
import { rest, funcao, criarUsuario, apagarUsuariosCriados } from './apoio.mjs';

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
