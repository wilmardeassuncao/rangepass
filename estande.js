// Página do estande (estande.html): a moldura comum (menu lateral, de moldura.mjs) e uma parte por área.
// A área aberta vem do endereço (estande.html#recepcao). Neste plano só existe a Recepção: a lista do dia
// e a ficha de check-in. Tudo passa pela função "operacao" do servidor; a conta do desconto que aparece
// na ficha é só para mostrar (o servidor refaz a conta e decide o valor).
import { supabase, chamarFuncao } from './api.mjs';
import { montarMoldura } from './moldura.mjs';
import { parteDoEndereco, saudacao } from './menu-regras.mjs';
import { textoDoDescontoDaClasse } from './admin-regras.mjs';
import { formatarCpf, formatarTelefone } from './conta-regras.mjs';
import { linhasDoPreco } from './agendar-regras.mjs';
import {
    areasVisiveis, ROTULO_SITUACAO, podeAbrirFicha, textoDoHorario, textoDasPistas, textoDaLista, textoDoValor,
    dataBrasileira, usoDoParticipante, contaDaFicha, valorACobrarCentavos, linhasDaConta, avisosDaConta, corpoDoCheckIn,
    escolhasMantidas,
} from './estande-regras.mjs';
import { formatarReais } from './supabase/functions/_shared/precos.mjs';
import { FORMAS_PAGAMENTO, ROTULO_FORMA } from './supabase/functions/_shared/operacao.mjs';

const ERRO_PADRAO = 'Não foi possível concluir agora. Tente de novo em instantes.';
const ERRO_CARREGAR = 'Não foi possível carregar agora. Verifique a internet e tente de novo.';
const ENTRAR = 'conta.html?voltar=estande.html';
// Só este 403 quer dizer "sem acesso à conta". Outro 403 ("sem permissão") fica na tela, como erro.
const CONTA_DESATIVADA = 'Sua conta está desativada. Procure o atendimento do estande.';

let papeis = [];          // papéis de quem está logado (GET minha-conta)
let fuso = null;          // fuso do estande (vem nas respostas da operacao): as horas aparecem no relógio dele
let areaAtual = null;
let moldura = null;

// ---------- Ajudantes de tela ----------

function mostrarTela(id) {
    for (const tela of document.querySelectorAll('.tela')) tela.classList.toggle('ativa', tela.id === id);
    window.scrollTo(0, 0);
}

// Aviso no alto da página: vermelho para problema, verde (sucesso) para "deu certo".
function avisar(texto, { sucesso = false } = {}) {
    const aviso = document.getElementById('aviso');
    aviso.textContent = texto ?? '';
    aviso.classList.toggle('sucesso', Boolean(texto) && sucesso);
    aviso.hidden = !texto;
}

function criar(tag, { classe, texto } = {}, filhos = []) {
    const el = document.createElement(tag);
    if (classe) el.className = classe;
    if (texto !== undefined) el.textContent = texto;
    el.append(...filhos);
    return el;
}

// 401 (sem login) ou conta desativada: sair e ir para a página de entrar, que volta para cá.
function precisaEntrar(r) {
    return r.status === 401 || (r.status === 403 && r.dados?.erro === CONTA_DESATIVADA);
}

async function irParaEntrar() {
    await supabase.auth.signOut();
    location.replace(ENTRAR);
}

// ---------- Áreas ----------

const ABRIR_AREA = { recepcao: abrirRecepcao };

function escolherArea(id) {
    areaAtual = id;
    avisar(null);
    for (const painel of document.querySelectorAll('#tela-estande > .painel')) painel.hidden = painel.id !== `painel-${id}`;
    moldura?.marcarAtivo(`estande-${id}`);
    ABRIR_AREA[id]?.();
}

// O endereço manda: abre a área do "#". Área proibida ou desconhecida abre a primeira permitida (na
// ordem do menu), sem mensagem, e o endereço passa a mostrar essa área.
function abrirAreaDoEndereco() {
    const id = parteDoEndereco(location.hash, areasVisiveis(papeis));
    if (!id) return;
    if (location.hash !== `#${id}`) history.replaceState(null, '', `#${id}`);
    if (id === areaAtual) return;
    escolherArea(id);
    window.scrollTo(0, 0);
}

const telaEstandeAberta = () => document.getElementById('tela-estande').classList.contains('ativa');

window.addEventListener('hashchange', () => {
    if (telaEstandeAberta()) abrirAreaDoEndereco();
});

// Tocar no item do menu da área que já está aberta volta para o começo dela e atualiza
// (o endereço não muda, então o navegador não avisa sozinho).
document.addEventListener('click', (evento) => {
    const link = evento.target.closest('a.moldura-item[data-item^="estande-"]');
    if (!link || !telaEstandeAberta()) return;
    const area = link.dataset.item.replace(/^estande-/, '');
    if (area !== areaAtual || location.hash !== `#${area}`) return;
    evento.preventDefault();
    escolherArea(area);
});

// "Sair" da tela de erro (quando o menu ainda não existe).
document.getElementById('botao-erro-sair').addEventListener('click', async (evento) => {
    evento.currentTarget.disabled = true;
    try {
        await supabase.auth.signOut();
    } catch (erro) {
        console.error(erro);
    } finally {
        location.replace('conta.html');
    }
});

// ---------- Recepção: lista do dia ----------

const vistaLista = document.getElementById('recepcao-lista');
const vistaFicha = document.getElementById('recepcao-ficha');
const botaoAtualizar = document.getElementById('botao-atualizar');
let pedidoDaLista = 0;   // só a resposta do último pedido vale (Atualizar várias vezes seguidas)
let pedidoDaFicha = 0;

function mostrarVista(vista) {
    vistaLista.hidden = vista !== 'lista';
    vistaFicha.hidden = vista !== 'ficha';
    window.scrollTo(0, 0);
}

function abrirRecepcao() {
    abrirLista();
}

// Volta para a lista e a carrega de novo. O aviso de cima fica (ex.: "Check-in feito.").
function abrirLista() {
    mostrarVista('lista');
    carregarLista();
}

function mostrarEstadoLista(estado, mensagem) {
    document.getElementById('recepcao-carregando').hidden = estado !== 'carregando';
    const erro = document.getElementById('recepcao-erro');
    erro.hidden = estado !== 'erro';
    erro.textContent = estado === 'erro' ? mensagem : '';
    document.getElementById('recepcao-vazio').hidden = estado !== 'vazio';
    document.getElementById('tabela-recepcao').hidden = estado !== 'pronto';
}

function celula(coluna, ...filhos) {
    const td = document.createElement('td');
    td.dataset.coluna = coluna;
    td.append(...filhos);
    return td;
}

function rotuloDaSituacao(situacao) {
    return criar('span', { classe: `rotulo situacao-${situacao}`, texto: ROTULO_SITUACAO[situacao] ?? situacao });
}

function linhaDaLista(a) {
    const tr = document.createElement('tr');
    tr.dataset.id = a.id;
    const responsavel = criar('span', { classe: 'celula-texto' }, [
        criar('span', { texto: a.responsavel?.nome || '—' }),
        criar('span', { texto: a.responsavel?.telefone ? formatarTelefone(a.responsavel.telefone) : 'Sem telefone' }),
    ]);
    const acoes = celula('Ações');
    acoes.className = 'celula-acoes';
    if (podeAbrirFicha(a.situacao)) {
        const botao = criar('button', { classe: 'botao pequeno', texto: 'Fazer check-in' });
        botao.type = 'button';
        botao.dataset.acao = 'check-in';
        acoes.append(botao);
    }
    const { valor, nota } = textoDoValor(a);
    const celulaValor = criar('span', { classe: 'celula-texto' }, [criar('span', { classe: 'sem-quebra', texto: valor })]);
    if (nota) celulaValor.append(criar('span', { texto: nota }));
    tr.append(
        celula('Horário', criar('span', { classe: 'sem-quebra', texto: textoDoHorario(a.inicio, a.horas, fuso) })),
        celula('Responsável', responsavel),
        celula('Pessoas', String(a.pessoas)),
        celula('Pista', criar('span', { classe: 'sem-quebra', texto: textoDasPistas(a.pistas) })),
        celula('Instrutor', textoDaLista(a.instrutores)),
        celula('Valor', celulaValor),
        celula('Situação', rotuloDaSituacao(a.situacao)),
        acoes,
    );
    return tr;
}

async function carregarLista() {
    const pedido = ++pedidoDaLista;
    botaoAtualizar.disabled = true;
    mostrarEstadoLista('carregando');
    try {
        const r = await chamarFuncao('operacao', { consulta: 'area=recepcao' });
        if (pedido !== pedidoDaLista) return;
        if (precisaEntrar(r)) return irParaEntrar();
        if (r.status !== 200) return mostrarEstadoLista('erro', r.dados?.erro ?? ERRO_CARREGAR);
        fuso = r.dados.fuso;
        document.getElementById('recepcao-dia').textContent = `Agendamentos de hoje, ${dataBrasileira(r.dados.hoje)}.`;
        const agendamentos = r.dados.agendamentos ?? [];
        document.getElementById('linhas-recepcao').replaceChildren(...agendamentos.map(linhaDaLista));
        mostrarEstadoLista(agendamentos.length ? 'pronto' : 'vazio');
    } catch (erro) {
        console.error(erro);
        if (pedido === pedidoDaLista) mostrarEstadoLista('erro', ERRO_CARREGAR);
    } finally {
        if (pedido === pedidoDaLista) botaoAtualizar.disabled = false;
    }
}

botaoAtualizar.addEventListener('click', () => {
    avisar(null);
    carregarLista();
});

document.getElementById('linhas-recepcao').addEventListener('click', (evento) => {
    const botao = evento.target.closest('button[data-acao="check-in"]');
    if (!botao) return;
    avisar(null);
    abrirFicha(botao.closest('tr').dataset.id);
});

// ---------- Recepção: ficha de check-in ----------

const form = document.getElementById('form-check-in');
const selectClasse = document.getElementById('ficha-classe');
const botaoConfirmar = document.getElementById('botao-confirmar');
let ficha = null;        // a resposta do GET operacao?id= (agendamento, classes, custo da munição)
let fichaId = null;

function montarFormas() {
    document.getElementById('lista-formas').replaceChildren(...FORMAS_PAGAMENTO.map((forma) => {
        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = 'forma_pagamento';
        radio.value = forma;
        return criar('label', { classe: 'forma' }, [radio, criar('span', { texto: ROTULO_FORMA[forma] })]);
    }));
}

function limparErros() {
    for (const el of form.querySelectorAll('[data-erro-para]')) el.textContent = '';
    for (const el of form.querySelectorAll('[aria-invalid]')) el.removeAttribute('aria-invalid');
    mostrarErroGeral(null);
}

function mostrarErroGeral(mensagem) {
    const geral = form.querySelector('[data-erro-geral]');
    geral.textContent = mensagem ?? '';
    geral.hidden = !mensagem;
}

// Cada chave de `campos` vai para o lugar com data-erro-para igual; sem lugar, vira o erro geral.
function mostrarErros(campos) {
    for (const [chave, mensagem] of Object.entries(campos)) {
        const lugar = form.querySelector(`[data-erro-para="${chave}"]`);
        if (!lugar || lugar.closest('[hidden]')) {
            mostrarErroGeral(mensagem);
            continue;
        }
        lugar.textContent = mensagem;
        const campo = form.elements.namedItem(chave);
        if (campo instanceof HTMLInputElement || campo instanceof HTMLSelectElement) campo.setAttribute('aria-invalid', 'true');
        form.querySelector(`[data-grupo-erro="${chave}"]`)?.setAttribute('aria-invalid', 'true');
    }
    const primeiro = form.querySelector('[aria-invalid="true"]')
        ?? [...form.querySelectorAll('[data-erro-para], [data-erro-geral]')].find((el) => el.textContent);
    primeiro?.scrollIntoView?.({ block: 'center' });
    if (primeiro?.matches('input, select')) primeiro.focus({ preventScroll: true });
}

function mostrarEstadoFicha(estado, mensagem) {
    document.getElementById('ficha-carregando').hidden = estado !== 'carregando';
    const erro = document.getElementById('ficha-erro');
    erro.hidden = estado !== 'erro';
    erro.textContent = estado === 'erro' ? mensagem : '';
    form.hidden = estado !== 'pronto';
    document.getElementById('ficha-so-voltar').hidden = estado !== 'erro';
}

function abrirFicha(id) {
    fichaId = id;
    mostrarVista('ficha');
    carregarFicha();
}

// `escolhas` (opcional): o que a atendente tinha escolhido, para reaplicar na ficha recarregada.
async function carregarFicha(escolhas = null) {
    const pedido = ++pedidoDaFicha;
    ficha = null;
    document.getElementById('ficha-sessao').textContent = '';
    mostrarEstadoFicha('carregando');
    try {
        const r = await chamarFuncao('operacao', { consulta: `id=${encodeURIComponent(fichaId)}` });
        if (pedido !== pedidoDaFicha) return;
        if (precisaEntrar(r)) return irParaEntrar();
        if (r.status !== 200) return mostrarEstadoFicha('erro', r.dados?.erro ?? ERRO_CARREGAR);
        ficha = r.dados;
        fuso = r.dados.fuso;
        preencherFicha(escolhas);
        mostrarEstadoFicha('pronto');
    } catch (erro) {
        console.error(erro);
        if (pedido === pedidoDaFicha) mostrarEstadoFicha('erro', ERRO_CARREGAR);
    }
}

function dadosEmLista(pares) {
    return criar('dl', { classe: 'dados' }, pares.map(([nome, valor]) => criar('div', {}, [
        criar('dt', { texto: nome }), criar('dd', { texto: valor }),
    ])));
}

function cartaoDoParticipante(p) {
    const uso = usoDoParticipante(p);
    return criar('li', { classe: 'participante' }, [
        criar('p', { classe: 'participante-nome', texto: p.nome_completo }),
        dadosEmLista([
            ['CPF', p.cpf ? formatarCpf(p.cpf) : '—'],
            ['Nascimento', dataBrasileira(p.data_nascimento)],
            ['Arma', uso.arma],
            ['Munição', uso.municao],
        ]),
    ]);
}

function preencherFicha(escolhas = null) {
    const { agendamento: a, classes } = ficha;
    form.reset();
    limparErros();
    // O servidor só entrega a ficha de uma sessão de hoje, por isso o "Hoje".
    const responsavel = a.responsavel?.nome;
    document.getElementById('ficha-sessao').textContent = `Hoje, ${textoDoHorario(a.inicio, a.horas, fuso)}`
        + (responsavel ? ` · ${responsavel}` : '');
    document.getElementById('ficha-participantes').replaceChildren(...(a.participantes ?? []).map(cartaoDoParticipante));

    const motivo = document.getElementById('ficha-motivo');
    motivo.textContent = ficha.motivo ?? '';
    motivo.hidden = ficha.pode_fazer_check_in;

    const pago = a.situacao === 'pago';
    const temPreco = a.preco_detalhe != null;
    const pedePagamento = ficha.pode_fazer_check_in && !pago;
    document.getElementById('ficha-bloco-valor').hidden = !ficha.pode_fazer_check_in;
    document.getElementById('ficha-pago').hidden = !pago;
    document.getElementById('ficha-sem-preco').hidden = !pedePagamento || temPreco;
    document.getElementById('ficha-com-preco').hidden = !pedePagamento || !temPreco;
    document.getElementById('ficha-formas').hidden = !pedePagamento;
    botaoConfirmar.hidden = !ficha.pode_fazer_check_in;

    if (temPreco) {
        document.getElementById('ficha-preco').replaceChildren(...linhasDoPreco(a.preco_detalhe).map(({ rotulo, valor }, i, todas) => {
            const par = criar('div', {}, [criar('dt', { texto: rotulo }), criar('dd', { texto: valor })]);
            if (i === todas.length - 1) par.className = 'total';
            else if (a.preco_detalhe.desconto && i === todas.length - 2) par.className = 'desconto';
            return par;
        }));
    }
    const semDesconto = criar('option', { texto: 'Sem desconto' });
    semDesconto.value = '';
    selectClasse.replaceChildren(semDesconto, ...classes.map((c) => {
        const opcao = criar('option', { texto: `${c.nome} (${textoDoDescontoDaClasse(c)})` });
        opcao.value = String(c.id);
        return opcao;
    }));
    selectClasse.value = '';
    if (escolhas) reaplicarEscolhas(escolhasMantidas(escolhas, classes));
    atualizarConta();
}

function escolhasDoForm() {
    return {
        forma_pagamento: form.elements.forma_pagamento?.value ?? '',
        classe_id: selectClasse.value,
        documento: form.elements.documento.value,
        valor_texto: form.elements.valor_centavos.value,
    };
}

function reaplicarEscolhas({ forma_pagamento, classe_id, documento }) {
    for (const radio of form.querySelectorAll('input[name="forma_pagamento"]')) radio.checked = radio.value === forma_pagamento;
    selectClasse.value = classe_id;
    form.elements.documento.value = documento;
}

// Mostra a conta da classe escolhida (ou o valor do agendamento, sem classe) e o valor a cobrar.
function atualizarConta() {
    if (!ficha || ficha.agendamento.preco_detalhe == null) return;
    const conta = contaDaFicha(ficha, selectClasse.value);
    document.getElementById('campo-documento').hidden = !conta;
    document.getElementById('ficha-preco').hidden = Boolean(conta);
    document.getElementById('ficha-conta').hidden = !conta;
    document.getElementById('ficha-valor-a-cobrar').hidden = Boolean(conta);
    document.getElementById('ficha-valor-a-cobrar-texto').textContent = formatarReais(valorACobrarCentavos(ficha, conta));

    document.getElementById('linhas-conta').replaceChildren(...(conta ? linhasDaConta(conta, ficha.agendamento.preco_detalhe) : [])
        .map((l) => {
            const tr = criar('tr', { classe: `conta-${l.tipo}` }, [
                criar('th', { texto: l.rotulo }),
                criar('td', { texto: l.antes }),
                criar('td', { texto: l.desconto }),
                criar('td', { texto: l.depois }),
            ]);
            tr.firstElementChild.scope = 'row';
            if (l.tipo !== 'parte' && l.tipo !== 'total') {
                // Valor do agendamento e valor a cobrar: o rótulo ocupa as três primeiras colunas.
                tr.firstElementChild.colSpan = 3;
                tr.children[1].remove();
                tr.children[1].remove();
            }
            return tr;
        }));

    const avisos = avisosDaConta(conta);
    const lista = document.getElementById('ficha-avisos-conta');
    lista.replaceChildren(...avisos.map((texto) => criar('li', { texto })));
    lista.hidden = avisos.length === 0;
}

selectClasse.addEventListener('change', () => {
    for (const nome of ['classe_id', 'documento', 'valor_esperado_centavos']) {
        const lugar = form.querySelector(`[data-erro-para="${nome}"]`);
        if (lugar) lugar.textContent = '';
    }
    atualizarConta();
});

for (const botao of document.querySelectorAll('#recepcao-ficha [data-acao="voltar"]')) {
    botao.addEventListener('click', () => {
        pedidoDaFicha += 1;
        avisar(null);
        abrirLista();
    });
}

form.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    if (!ficha) return;
    limparErros();
    const escolhas = escolhasDoForm();
    const { corpo, campos } = corpoDoCheckIn(ficha, escolhas);
    if (Object.keys(campos).length) return mostrarErros(campos);

    const botoes = form.querySelectorAll('button, select, input');
    botoes.forEach((el) => { el.disabled = true; });
    try {
        const r = await chamarFuncao('operacao', { metodo: 'POST', corpo });
        if (precisaEntrar(r)) return irParaEntrar();
        if (r.status === 200) {
            avisar('Check-in feito.', { sucesso: true });
            return abrirLista();
        }
        if (r.status === 400 && r.dados?.campos) {
            mostrarErros(r.dados.campos);
            if (r.dados.erro && !form.querySelector('[data-erro-geral]').textContent) mostrarErroGeral(r.dados.erro);
            return;
        }
        if (r.status === 409) {
            // A situação, a classe ou o valor mudou: avisa e mostra a ficha como está agora, com as
            // escolhas da atendente reaplicadas (a classe só se ainda estiver ativa).
            avisar(r.dados?.erro ?? ERRO_PADRAO);
            window.scrollTo(0, 0);
            return carregarFicha(escolhas);
        }
        if (r.status === 404) {
            avisar(r.dados?.erro ?? ERRO_PADRAO);
            return abrirLista();
        }
        mostrarErroGeral(r.dados?.erro ?? ERRO_PADRAO);
    } catch (erro) {
        console.error(erro);
        mostrarErroGeral(ERRO_PADRAO);
    } finally {
        botoes.forEach((el) => { el.disabled = false; });
    }
});

montarFormas();

// ---------- Início ----------

function mostrarErroCarregar(mensagem) {
    document.getElementById('erro-carregar-mensagem').textContent = mensagem ?? ERRO_CARREGAR;
    mostrarTela('tela-erro');
}

async function carregar() {
    mostrarTela('tela-carregando');
    const r = await chamarFuncao('minha-conta');
    if (precisaEntrar(r)) return irParaEntrar();
    if (r.status !== 200) return mostrarErroCarregar(r.dados?.erro);
    papeis = r.dados.papeis ?? [];
    moldura = montarMoldura({ papeis, ativo: null, saudacao: saudacao(r.dados.perfil, r.dados.email) });
    if (areasVisiveis(papeis).length === 0) return mostrarTela('tela-sem-acesso');
    mostrarTela('tela-estande');
    areaAtual = null;
    abrirAreaDoEndereco();
}

function carregarComErro() {
    return carregar().catch((erro) => {
        console.error(erro);
        mostrarErroCarregar(null);
    });
}

document.getElementById('botao-tentar-de-novo').addEventListener('click', async () => {
    const botoes = document.querySelectorAll('#tela-erro button');
    botoes.forEach((b) => { b.disabled = true; });
    try {
        await carregarComErro();
    } finally {
        botoes.forEach((b) => { b.disabled = false; });
    }
});

async function iniciar() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return location.replace(ENTRAR);
    return carregarComErro();
}

iniciar().catch((erro) => {
    console.error(erro);
    mostrarErroCarregar(null);
});
