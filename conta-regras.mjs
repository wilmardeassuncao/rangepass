// Regras puras da página da conta: mensagens de erro do login e formatação para mostrar na tela.

const MENSAGENS_LOGIN = {
    invalid_credentials: 'E-mail ou senha incorretos. Confira e tente de novo.',
    email_not_confirmed: 'Confirme o seu e-mail antes de entrar. Procure o link na sua caixa de entrada (e no spam).',
    over_request_rate_limit: 'Muitas tentativas em pouco tempo. Espere alguns minutos e tente de novo.',
    over_email_send_rate_limit: 'Muitas tentativas em pouco tempo. Espere alguns minutos e tente de novo.',
    weak_password: 'Escolha uma senha mais forte, com pelo menos 8 caracteres.',
    same_password: 'A nova senha precisa ser diferente da anterior.',
    user_banned: 'Sua conta está desativada. Procure o atendimento do estande.',
};

export function mensagemDoErroDeLogin(erro) {
    return MENSAGENS_LOGIN[erro?.code] ?? 'Não foi possível concluir agora. Tente de novo em instantes.';
}

export function formatarCpf(cpf) {
    return /^\d{11}$/.test(cpf ?? '') ? cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4') : cpf;
}

export function formatarTelefone(telefone) {
    if (/^\d{11}$/.test(telefone ?? '')) return telefone.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3');
    if (/^\d{10}$/.test(telefone ?? '')) return telefone.replace(/(\d{2})(\d{4})(\d{4})/, '($1) $2-$3');
    return telefone;
}
