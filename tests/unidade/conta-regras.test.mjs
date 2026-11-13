// tests/unidade/conta-regras.test.mjs
import test from 'node:test';
import assert from 'node:assert';
import { mensagemDoErroDeLogin, formatarCpf, formatarTelefone } from '../../conta-regras.mjs';

const PADRAO = 'Não foi possível concluir agora. Tente de novo em instantes.';

test('mensagemDoErroDeLogin traduz cada erro do Supabase Auth', () => {
    assert.strictEqual(mensagemDoErroDeLogin({ code: 'invalid_credentials' }), 'E-mail ou senha incorretos. Confira e tente de novo.');
    assert.strictEqual(mensagemDoErroDeLogin({ code: 'email_not_confirmed' }), 'Confirme o seu e-mail antes de entrar. Procure o link na sua caixa de entrada (e no spam).');
    assert.strictEqual(mensagemDoErroDeLogin({ code: 'over_request_rate_limit' }), 'Muitas tentativas em pouco tempo. Espere alguns minutos e tente de novo.');
    assert.strictEqual(mensagemDoErroDeLogin({ code: 'over_email_send_rate_limit' }), 'Muitas tentativas em pouco tempo. Espere alguns minutos e tente de novo.');
    assert.strictEqual(mensagemDoErroDeLogin({ code: 'weak_password' }), 'Escolha uma senha mais forte, com pelo menos 8 caracteres.');
    assert.strictEqual(mensagemDoErroDeLogin({ code: 'same_password' }), 'A nova senha precisa ser diferente da anterior.');
    assert.strictEqual(mensagemDoErroDeLogin({ code: 'user_banned' }), 'Sua conta está desativada. Procure o atendimento do estande.');
});

test('mensagemDoErroDeLogin tem uma mensagem padrão para o resto', () => {
    assert.strictEqual(mensagemDoErroDeLogin({ code: 'qualquer_outro' }), PADRAO);
    assert.strictEqual(mensagemDoErroDeLogin({}), PADRAO);
    assert.strictEqual(mensagemDoErroDeLogin(null), PADRAO);
    assert.strictEqual(mensagemDoErroDeLogin(undefined), PADRAO);
});

test('formatarCpf põe pontos e traço', () => {
    assert.strictEqual(formatarCpf('52998224725'), '529.982.247-25');
    assert.strictEqual(formatarCpf('123'), '123');
});

test('formatarTelefone mostra DDD, celular e fixo', () => {
    assert.strictEqual(formatarTelefone('11987654321'), '(11) 98765-4321');
    assert.strictEqual(formatarTelefone('1134567890'), '(11) 3456-7890');
    assert.strictEqual(formatarTelefone('123'), '123');
    assert.strictEqual(formatarTelefone(null), null);
});
