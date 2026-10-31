function interpretarResposta(ok, corpo) {
    if (!ok) return 'falha';

    let dados;
    try {
        dados = JSON.parse(corpo);
    } catch (erro) {
        return 'falha';
    }

    if (dados?.status === 'ok') return 'sucesso';
    if (dados?.status === 'conflito') return 'conflito';
    return 'falha';
}

if (typeof module !== 'undefined') {
    module.exports = { interpretarResposta };
}
