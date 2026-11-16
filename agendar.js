// Página do cliente: "Meus agendamentos" (GET agendamentos), alterar horário e cancelar (PUT agendamentos)
// e o novo agendamento, montado só com o que o servidor manda (GET agendamentos?ver=opcoes),
// conferido com as mesmas regras do servidor e enviado (POST agendamentos).
import { supabase, chamarFuncao } from './api.mjs';
import {
    descreverSessao, modelosDaCategoria, municoesDoModelo, nomeDoCalibre,
    TEXTO_SITUACAO, separarAgendamentos, armaDoParticipante, municaoDoParticipante,
} from './agendar-regras.mjs';
import {
    validarPedido, validarNovoHorario, horariosDoDia, duracoesPossiveis, instrutoresNecessarios, partesNoFuso,
} from './supabase/functions/_shared/agendamento.mjs';
import { dataNoFuso } from './supabase/functions/_shared/cadastro.mjs';

const ERRO_PADRAO = 'Não foi possível concluir agora. Tente de novo em instantes.';
const ENTRAR = 'conta.html?voltar=index.html';
// Só este 403 quer dizer "sem acesso". O 403 de prazo ("Faltam menos de N horas…") fica na tela, como aviso.
const CONTA_DESATIVADA = 'Sua conta está desativada. Procure o atendimento do estande.';
const ATIVAS = ['aguardando_pagamento', 'pago'];

const form = document.getElementById('form-agendar');
const listaParticipantes = document.getElementById('participantes');
const botaoAdicionar = document.getElementById('botao-adicionar');
const revisao = document.getElementById('revisao');
const formAlterar = document.getElementById('form-alterar');

let opcoes = null;          // resposta do GET ?ver=opcoes
let pedidoAtual = null;     // o que vai no POST, montado ao revisar
let itemAlterando = null;   // o agendamento (Item do servidor) aberto em "Alterar horário"

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
    if (texto) window.scrollTo(0, 0);
}

// Erro geral do lugar; se o lugar não tem espaço para ele (um cartão da lista), vai para o aviso.
function mostrarErroGeral(lugar, mensagem) {
    const geral = lugar.querySelector('[data-erro-geral]');
    if (!geral) {
        if (mensagem) avisar(mensagem);
        return;
    }
    geral.textContent = mensagem ?? '';
    geral.hidden = !mensagem;
}

function limparErros(f = form) {
    for (const el of f.querySelectorAll('[data-erro-para], [data-erro]')) el.textContent = '';
    for (const el of f.querySelectorAll('[aria-invalid]')) el.removeAttribute('aria-invalid');
    mostrarErroGeral(f, null);
}

// Cada chave de `campos` vai para o seu lugar: 'participantes.2.cpf' fica no cartão 3.
function mostrarErros(campos, f = form) {
    for (const [chave, mensagem] of Object.entries(campos)) {
        const partes = f === form ? chave.match(/^participantes\.(\d+)\.(.+)$/) : null;
        const cartao = partes ? cartoes()[Number(partes[1])] : null;
        const lugar = partes
            ? cartao?.querySelector(`[data-erro="${partes[2]}"]`)
            : f.querySelector(`[data-erro-para="${chave}"]`);
        if (!lugar) {
            mostrarErroGeral(f, mensagem);
            continue;
        }
        lugar.textContent = mensagem;
        const campo = partes ? cartao.querySelector(`[data-campo="${partes[2]}"]`) : f.elements[chave];
        campo?.setAttribute('aria-invalid', 'true');
    }
    const primeiro = f.querySelector('[aria-invalid="true"]')
        ?? [...f.querySelectorAll('[data-erro-para], [data-erro]')].find((el) => el.textContent);
    primeiro?.scrollIntoView?.({ block: 'center' });
    if (primeiro?.matches('input, select')) primeiro.focus();
}

// Desabilita os botões do lugar enquanto a chamada está em andamento.
async function ocupado(lugar, acao) {
    const botoes = lugar.querySelectorAll('button');
    botoes.forEach((b) => { b.disabled = true; });
    try {
        await acao();
    } catch (erro) {
        console.error(erro);
        mostrarErroGeral(lugar, ERRO_PADRAO);
    } finally {
        botoes.forEach((b) => { b.disabled = false; });
    }
}

// 401 (sem login) ou conta desativada: sair e ir para a página de entrar.
function precisaEntrar(r) {
    return r.status === 401 || (r.status === 403 && r.dados?.erro === CONTA_DESATIVADA);
}

async function irParaEntrar() {
    await supabase.auth.signOut();
    location.replace(ENTRAR);
}

function opcao(valor, texto) {
    const el = document.createElement('option');
    el.value = valor;
    el.textContent = texto;
    return el;
}

// Troca as opções de um <select> e mantém a escolha anterior quando ela ainda existe.
function preencherSelect(select, itens, { vazio } = {}) {
    const anterior = select.value;
    select.replaceChildren();
    if (vazio) select.append(opcao('', vazio));
    for (const [valor, texto] of itens) select.append(opcao(String(valor), texto));
    if ([...select.options].some((o) => o.value === anterior)) select.value = anterior;
}

// Os valores do <select> são textos; aqui volta o id original (número ou texto) do item do servidor.
function idDe(lista, valor) {
    return lista.find((item) => String(item.id) === valor)?.id ?? null;
}

function somarDias(data, dias) {
    const d = new Date(`${data}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + dias);
    return d.toISOString().slice(0, 10);
}

const doisDigitos = (n) => String(n).padStart(2, '0');
const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;

// ---------- Quando (dia, horário e duração) ----------
// Os mesmos campos servem ao novo agendamento (form) e ao "Alterar horário" (formAlterar).
// `maximo` é uma função que diz a duração máxima: depende de quantas pessoas vão.

function duracaoMaxima(quantidade) {
    const { agenda } = opcoes;
    return quantidade > 1 ? agenda.duracao_maxima_grupo : agenda.duracao_maxima_individual;
}

const maximoNovo = () => duracaoMaxima(cartoes().length);
const maximoAlterar = () => duracaoMaxima(itemAlterando.participantes.length);

// O dia vai de hoje (no fuso do estande) até a antecedência máxima.
function limitarDatas(f) {
    const hoje = dataNoFuso(new Date(), opcoes.estande.fuso);
    f.elements.data.min = hoje;
    f.elements.data.max = somarDias(hoje, opcoes.agenda.antecedencia_maxima_dias);
}

function atualizarHorarios(f, maximo) {
    const data = f.elements.data.value;
    const seletor = f.elements.hora;
    const erroData = f.querySelector('[data-erro-para="data"]');
    const horarios = data ? horariosDoDia(data, opcoes.funcionamento) : [];
    erroData.textContent = data && horarios.length === 0 ? 'O estande não abre neste dia. Escolha outro.' : '';
    preencherSelect(seletor, horarios.map((h) => [h, `${doisDigitos(h)}:00`]), { vazio: 'Escolha o horário' });
    seletor.disabled = horarios.length === 0;
    atualizarDuracoes(f, maximo);
}

function atualizarDuracoes(f, maximo) {
    const data = f.elements.data.value;
    const hora = f.elements.hora.value === '' ? null : Number(f.elements.hora.value);
    const seletor = f.elements.horas;
    const duracoes = hora === null ? [] : duracoesPossiveis(data, hora, opcoes.funcionamento, maximo());
    preencherSelect(seletor, duracoes.map((k) => [k, `${plural(k, 'hora', 'horas')} (até ${doisDigitos(hora + k)}:00)`]));
    seletor.disabled = duracoes.length === 0;
}

// ---------- Participantes ----------

function cartoes() {
    return [...listaParticipantes.querySelectorAll('[data-participante]')];
}

function campo(cartao, nome) {
    return cartao.querySelector(`[data-campo="${nome}"]`);
}

function nomeDoModelo(modelo) {
    return `${modelo.marca} ${modelo.nome}`;
}

function nomeDaMunicao(tipo) {
    const calibre = opcoes.catalogo.calibres.find((c) => c.id === tipo.calibre_id)?.nome;
    return calibre ? `${tipo.nome} (${calibre})` : tipo.nome;
}

function atualizarArmaDoEstande(cartao) {
    const { catalogo } = opcoes;
    const categoriaId = idDe(catalogo.categorias, campo(cartao, 'categoria').value);
    const modelos = modelosDaCategoria(catalogo, categoriaId);
    preencherSelect(campo(cartao, 'modelo_id'), modelos.map((m) => [m.id, nomeDoModelo(m)]), { vazio: 'Escolha o modelo' });
    atualizarMunicao(cartao);
}

function atualizarMunicao(cartao) {
    const { catalogo } = opcoes;
    const modalidade = campo(cartao, 'modalidade').value;
    const modeloId = idDe(catalogo.modelos, campo(cartao, 'modelo_id').value);
    campo(cartao, 'calibre_estande').value = nomeDoCalibre(catalogo, modeloId);
    const tipos = modalidade === 'estande' ? municoesDoModelo(catalogo, modeloId) : catalogo.tipos_municao;
    preencherSelect(campo(cartao, 'tipo_municao_id'), tipos.map((t) => [t.id, nomeDaMunicao(t)]), { vazio: 'Escolha a munição' });
}

function atualizarModalidade(cartao) {
    const modalidade = campo(cartao, 'modalidade').value;
    const grupos = {
        estande: modalidade === 'estande',
        propria: modalidade !== 'estande',
        municao: modalidade !== 'tudo_proprio',
        termo: modalidade !== 'estande',
    };
    for (const [nome, visivel] of Object.entries(grupos)) cartao.querySelector(`[data-grupo="${nome}"]`).hidden = !visivel;
    atualizarMunicao(cartao);
}

function novoCartao() {
    const cartao = document.getElementById('modelo-participante').content.firstElementChild.cloneNode(true);
    const { catalogo, municao, termo } = opcoes;
    // Só as categorias que têm algum modelo disponível.
    const categorias = catalogo.categorias.filter((c) => catalogo.modelos.some((m) => m.categoria_id === c.id));
    preencherSelect(campo(cartao, 'categoria'), categorias.map((c) => [c.id, c.nome]), { vazio: 'Escolha a categoria' });
    const quantidade = campo(cartao, 'municao_qtd');
    quantidade.min = municao.minima_por_participante;
    quantidade.value = municao.minima_por_participante;
    cartao.querySelector('[data-texto-minimo]').textContent = `(mínimo ${municao.minima_por_participante})`;
    cartao.querySelector('[data-texto-termo]').textContent = termo.texto;

    campo(cartao, 'modalidade').addEventListener('change', () => atualizarModalidade(cartao));
    campo(cartao, 'categoria').addEventListener('change', () => atualizarArmaDoEstande(cartao));
    campo(cartao, 'modelo_id').addEventListener('change', () => atualizarMunicao(cartao));
    cartao.querySelector('[data-remover]').addEventListener('click', () => {
        cartao.remove();
        atualizarGrupo();
    });
    atualizarArmaDoEstande(cartao);
    atualizarModalidade(cartao);
    return cartao;
}

function adicionarParticipante() {
    listaParticipantes.append(novoCartao());
    atualizarGrupo();
}

// Títulos, botão de adicionar, durações e a linha de instrutores e pistas acompanham o tamanho do grupo.
function atualizarGrupo() {
    const todos = cartoes();
    todos.forEach((cartao, i) => {
        const primeiro = i === 0;
        cartao.querySelector('[data-titulo]').textContent = primeiro
            ? `Você (${opcoes.responsavel.nome_completo})`
            : `Participante ${i + 1}`;
        cartao.querySelector('[data-grupo="convidado"]').hidden = primeiro;
        cartao.querySelector('[data-remover]').hidden = primeiro;
    });
    const { agenda } = opcoes;
    botaoAdicionar.hidden = todos.length >= agenda.grupo_maximo;
    const n = instrutoresNecessarios(todos.length, agenda.faixas_instrutores);
    document.getElementById('ocupacao').textContent = todos.length > 1
        ? `Este grupo vai ocupar ${plural(n, 'instrutor', 'instrutores')} e ${plural(n, 'pista', 'pistas')}.`
        : `Você vai ocupar ${plural(n, 'instrutor', 'instrutores')} e ${plural(n, 'pista', 'pistas')}.`;
    atualizarDuracoes(form, maximoNovo);
}

// ---------- Montar o pedido ----------

function numeroOuNulo(texto) {
    return texto === '' ? null : Number(texto);
}

function lerParticipante(cartao, i) {
    const { catalogo, termo } = opcoes;
    const modalidade = campo(cartao, 'modalidade').value;
    const p = {};
    if (i > 0) {
        p.nome_completo = campo(cartao, 'nome_completo').value;
        p.cpf = campo(cartao, 'cpf').value;
        p.data_nascimento = campo(cartao, 'data_nascimento').value;
    }
    p.modalidade = modalidade;
    if (modalidade === 'estande') p.modelo_id = idDe(catalogo.modelos, campo(cartao, 'modelo_id').value);
    if (modalidade !== 'tudo_proprio') {
        p.tipo_municao_id = idDe(catalogo.tipos_municao, campo(cartao, 'tipo_municao_id').value);
        p.municao_qtd = numeroOuNulo(campo(cartao, 'municao_qtd').value);
    }
    if (modalidade !== 'estande') {
        p.arma_propria = {
            modelo: campo(cartao, 'arma_modelo').value,
            calibre: campo(cartao, 'arma_calibre').value,
            numero_registro: campo(cartao, 'arma_numero_registro').value,
            responsavel: campo(cartao, 'arma_responsavel').value,
        };
        if (campo(cartao, 'aceite').checked) p.aceite_termo_versao = termo.versao;
    }
    return p;
}

function lerPedido() {
    const instrutor = form.elements.instrutor_id.value;
    return {
        data: form.elements.data.value,
        hora: numeroOuNulo(form.elements.hora.value),
        horas: numeroOuNulo(form.elements.horas.value),
        instrutor_id: instrutor === '' ? null : idDe(opcoes.instrutores, instrutor),
        participantes: cartoes().map(lerParticipante),
    };
}

// ---------- Revisar ----------

function linhaDeDado(titulo, valor) {
    const div = document.createElement('div');
    const dt = document.createElement('dt');
    const dd = document.createElement('dd');
    dt.textContent = titulo;
    dd.textContent = valor;
    div.append(dt, dd);
    return div;
}

function descreverArma(p) {
    const { catalogo } = opcoes;
    if (p.modalidade === 'estande') {
        const modelo = catalogo.modelos.find((m) => m.id === p.modelo_id);
        return `${nomeDoModelo(modelo)} (${nomeDoCalibre(catalogo, modelo.id)}), do estande`;
    }
    return `${p.arma_propria.modelo.trim()} (${p.arma_propria.calibre.trim()}), arma própria`;
}

function descreverMunicao(p) {
    if (p.modalidade === 'tudo_proprio') return 'Própria';
    const tipo = opcoes.catalogo.tipos_municao.find((t) => t.id === p.tipo_municao_id);
    return `${p.municao_qtd} × ${nomeDaMunicao(tipo)}`;
}

function mostrarRevisao(pedido, inicio) {
    const { estande, instrutores, responsavel, agenda } = opcoes;
    document.getElementById('revisao-sessao').textContent = descreverSessao(inicio, pedido.horas, estande.fuso);
    document.getElementById('revisao-instrutor').textContent = pedido.instrutor_id === null
        ? 'Sem preferência'
        : instrutores.find((i) => i.id === pedido.instrutor_id).nome;
    const n = instrutoresNecessarios(pedido.participantes.length, agenda.faixas_instrutores);
    document.getElementById('revisao-ocupacao').textContent =
        `${plural(n, 'instrutor', 'instrutores')} e ${plural(n, 'pista', 'pistas')}`;

    const lista = document.getElementById('revisao-participantes');
    lista.replaceChildren();
    pedido.participantes.forEach((p, i) => {
        const dl = document.createElement('dl');
        dl.className = 'bloco dados';
        const titulo = document.createElement('p');
        titulo.className = 'bloco-titulo';
        titulo.textContent = i === 0 ? `Você (${responsavel.nome_completo})` : p.nome_completo.trim();
        dl.append(titulo, linhaDeDado('Arma', descreverArma(p)), linhaDeDado('Munição', descreverMunicao(p)));
        lista.append(dl);
    });
    mostrarErroGeral(revisao, null);
    mostrarTela('tela-revisar');
}

form.addEventListener('submit', (evento) => {
    evento.preventDefault();
    limparErros();
    avisar(null);
    const pedido = lerPedido();
    const { campos, pedido: conferido } = validarPedido(pedido, { agora: new Date(), opcoes });
    if (Object.keys(campos).length) return mostrarErros(campos);
    pedidoAtual = pedido;
    mostrarRevisao(pedido, conferido.inicio);
});

document.getElementById('botao-voltar').addEventListener('click', () => mostrarTela('tela-novo'));

document.getElementById('botao-confirmar').addEventListener('click', () => {
    mostrarErroGeral(revisao, null);
    ocupado(revisao, async () => {
        const r = await chamarFuncao('agendamentos', { metodo: 'POST', corpo: pedidoAtual });
        if (r.status === 201) {
            const ag = r.dados.agendamento;
            document.getElementById('sucesso-sessao').textContent = descreverSessao(ag.inicio, ag.horas, opcoes.estande.fuso);
            mostrarTela('tela-sucesso');
        } else if (precisaEntrar(r)) {
            await irParaEntrar();
        } else if (r.status === 400 && r.dados?.campos) {
            mostrarTela('tela-novo');
            limparErros();
            mostrarErros(r.dados.campos);
        } else {
            mostrarErroGeral(revisao, r.dados?.erro ?? ERRO_PADRAO);
        }
    });
});

document.getElementById('botao-ver-agendamentos').addEventListener('click', () => {
    avisar(null);
    ocupado(document.getElementById('tela-sucesso'), () => abrirLista());
});

botaoAdicionar.addEventListener('click', adicionarParticipante);
form.elements.data.addEventListener('change', () => atualizarHorarios(form, maximoNovo));
form.elements.hora.addEventListener('change', () => atualizarDuracoes(form, maximoNovo));

document.getElementById('botao-novo-voltar').addEventListener('click', () => {
    avisar(null);
    mostrarTela('tela-lista');
});

// ---------- Meus agendamentos ----------

function cartaoDoAgendamento(a, proximo) {
    const cartao = document.getElementById('modelo-agendamento').content.firstElementChild.cloneNode(true);
    const sessao = descreverSessao(a.inicio, a.horas, opcoes.estande.fuso);
    cartao.dataset.id = a.id;
    cartao.querySelector('[data-sessao]').textContent = sessao;
    const situacao = cartao.querySelector('[data-situacao]');
    situacao.textContent = TEXTO_SITUACAO[a.situacao] ?? a.situacao;
    situacao.dataset.valor = a.situacao;
    cartao.querySelector('[data-titulo-instrutores]').textContent = a.instrutores.length > 1 ? 'Instrutores' : 'Instrutor';
    cartao.querySelector('[data-instrutores]').textContent = a.instrutores.length ? a.instrutores.join(', ') : 'A definir';

    const lista = cartao.querySelector('[data-participantes]');
    for (const p of a.participantes) {
        const dl = document.createElement('dl');
        dl.className = 'dados participante';
        const titulo = document.createElement('p');
        titulo.className = 'bloco-titulo';
        titulo.textContent = p.nome_completo;
        dl.append(titulo, linhaDeDado('Arma', armaDoParticipante(p)), linhaDeDado('Munição', municaoDoParticipante(p)));
        lista.append(dl);
    }

    // Quem decide se ainda dá para mexer é o servidor (pode_alterar); a tela não recalcula o prazo.
    if (a.pode_alterar) {
        cartao.querySelector('[data-acoes]').hidden = false;
        cartao.querySelector('[data-alterar]').addEventListener('click', () => abrirAlterar(a));
        cartao.querySelector('[data-cancelar]').addEventListener('click', () => cancelar(a, sessao, cartao));
    } else if (proximo && ATIVAS.includes(a.situacao)) {
        const prazo = cartao.querySelector('[data-prazo]');
        prazo.textContent = `Faltam menos de ${a.prazo_alteracao_horas} horas. Para alterar ou cancelar, fale com o estande.`;
        prazo.hidden = false;
    }
    return cartao;
}

function preencherSecao(nome, itens, proximo) {
    document.getElementById(`lista-${nome}`).replaceChildren(...itens.map((a) => cartaoDoAgendamento(a, proximo)));
    document.getElementById(`secao-${nome}`).hidden = itens.length === 0;
}

function mostrarLista(agendamentos) {
    const { proximos, anteriores } = separarAgendamentos(agendamentos, new Date());
    preencherSecao('proximos', proximos, true);
    preencherSecao('anteriores', anteriores, false);
    document.getElementById('sem-agendamentos').hidden = agendamentos.length > 0;
}

// Busca a lista no servidor e mostra a tela; `mensagem` vira o aviso verde (ex.: 'Horário alterado.').
async function abrirLista(mensagem) {
    const r = await chamarFuncao('agendamentos');
    if (precisaEntrar(r)) return irParaEntrar();
    if (r.status !== 200) return avisar(r.dados?.erro ?? ERRO_PADRAO);
    mostrarLista(r.dados.agendamentos);
    mostrarTela('tela-lista');
    avisar(mensagem ?? null, { sucesso: true });
}

document.getElementById('botao-novo').addEventListener('click', () => {
    avisar(null);
    montarFormulario();
    mostrarTela('tela-novo');
});

// ---------- Alterar horário ----------

function abrirAlterar(a) {
    itemAlterando = a;
    avisar(null);
    formAlterar.reset();
    limparErros(formAlterar);
    document.getElementById('alterar-atual').textContent =
        `Agora: ${descreverSessao(a.inicio, a.horas, opcoes.estande.fuso)}`;
    limitarDatas(formAlterar);
    // Começa preenchido com o horário atual, no relógio do estande.
    const atual = partesNoFuso(new Date(a.inicio), opcoes.estande.fuso);
    formAlterar.elements.data.value = atual.data;
    atualizarHorarios(formAlterar, maximoAlterar);
    formAlterar.elements.hora.value = String(atual.hora);
    atualizarDuracoes(formAlterar, maximoAlterar);
    formAlterar.elements.horas.value = String(a.horas);
    mostrarTela('tela-alterar');
}

formAlterar.elements.data.addEventListener('change', () => atualizarHorarios(formAlterar, maximoAlterar));
formAlterar.elements.hora.addEventListener('change', () => atualizarDuracoes(formAlterar, maximoAlterar));

document.getElementById('botao-alterar-voltar').addEventListener('click', () => {
    avisar(null);
    mostrarTela('tela-lista');
});

formAlterar.addEventListener('submit', (evento) => {
    evento.preventDefault();
    limparErros(formAlterar);
    avisar(null);
    const novo = {
        data: formAlterar.elements.data.value,
        hora: numeroOuNulo(formAlterar.elements.hora.value),
        horas: numeroOuNulo(formAlterar.elements.horas.value),
    };
    const { campos } = validarNovoHorario(novo, {
        agora: new Date(), opcoes, quantidade: itemAlterando.participantes.length,
    });
    if (Object.keys(campos).length) return mostrarErros(campos, formAlterar);
    ocupado(formAlterar, async () => {
        const r = await chamarFuncao('agendamentos', {
            metodo: 'PUT', corpo: { id: itemAlterando.id, acao: 'alterar_horario', ...novo },
        });
        if (r.status === 200) return abrirLista('Horário alterado.');
        if (precisaEntrar(r)) return irParaEntrar();
        if (r.status === 400 && r.dados?.campos) return mostrarErros(r.dados.campos, formAlterar);
        avisar(r.dados?.erro ?? ERRO_PADRAO);   // 403 (prazo), 404, 409: aviso, e fica na tela
    });
});

// ---------- Cancelar ----------

function cancelar(a, sessao, cartao) {
    if (!window.confirm(`Cancelar o agendamento de ${sessao}?`)) return;
    avisar(null);
    ocupado(cartao, async () => {
        const r = await chamarFuncao('agendamentos', { metodo: 'PUT', corpo: { id: a.id, acao: 'cancelar' } });
        if (r.status === 200) return abrirLista('Agendamento cancelado.');
        if (precisaEntrar(r)) return irParaEntrar();
        avisar(r.dados?.erro ?? ERRO_PADRAO);   // 403 (prazo), 404, 409: aviso, e fica na lista
    });
}

// ---------- Início ----------

function montarFormulario() {
    const { instrutores } = opcoes;
    form.reset();
    limparErros();
    pedidoAtual = null;
    limitarDatas(form);
    preencherSelect(form.elements.instrutor_id, instrutores.map((i) => [i.id, i.nome]), { vazio: 'Sem preferência' });
    form.elements.instrutor_id.value = '';
    listaParticipantes.replaceChildren();
    adicionarParticipante();
    atualizarHorarios(form, maximoNovo);
}

async function iniciar() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return location.replace(ENTRAR);
    // As opções (fuso, horários, nome) e a lista vêm juntas, em paralelo.
    const [r, lista] = await Promise.all([
        chamarFuncao('agendamentos', { consulta: 'ver=opcoes' }),
        chamarFuncao('agendamentos'),
    ]);
    if (precisaEntrar(r) || precisaEntrar(lista)) return irParaEntrar();
    if (r.status !== 200) return avisar(r.dados?.erro ?? ERRO_PADRAO);
    opcoes = r.dados;
    document.getElementById('nome-estande').textContent = opcoes.estande.nome;
    document.getElementById('nome-cliente').textContent = opcoes.responsavel.nome_completo;
    if (lista.status !== 200) return avisar(lista.dados?.erro ?? ERRO_PADRAO);
    mostrarLista(lista.dados.agendamentos);
    mostrarTela('tela-lista');
}

iniciar().catch((erro) => {
    console.error(erro);
    avisar(ERRO_PADRAO);
});
