// Tela de novo agendamento: monta o formulário só com o que o servidor manda (GET agendamentos?ver=opcoes),
// confere com as mesmas regras do servidor e envia o pedido (POST agendamentos).
import { supabase, chamarFuncao } from './api.mjs';
import { descreverSessao, modelosDaCategoria, municoesDoModelo, nomeDoCalibre } from './agendar-regras.mjs';
import {
    validarPedido, horariosDoDia, duracoesPossiveis, instrutoresNecessarios,
} from './supabase/functions/_shared/agendamento.mjs';
import { dataNoFuso } from './supabase/functions/_shared/cadastro.mjs';

const ERRO_PADRAO = 'Não foi possível concluir agora. Tente de novo em instantes.';
const ENTRAR = 'conta.html?voltar=index.html';

const form = document.getElementById('form-agendar');
const listaParticipantes = document.getElementById('participantes');
const botaoAdicionar = document.getElementById('botao-adicionar');
const revisao = document.getElementById('revisao');

let opcoes = null;        // resposta do GET ?ver=opcoes
let pedidoAtual = null;   // o que vai no POST, montado ao revisar

// ---------- Ajudantes de tela ----------

function mostrarTela(id) {
    for (const tela of document.querySelectorAll('.tela')) tela.classList.toggle('ativa', tela.id === id);
    window.scrollTo(0, 0);
}

function avisar(texto) {
    const aviso = document.getElementById('aviso');
    aviso.textContent = texto ?? '';
    aviso.hidden = !texto;
}

function mostrarErroGeral(lugar, mensagem) {
    const geral = lugar.querySelector('[data-erro-geral]');
    geral.textContent = mensagem ?? '';
    geral.hidden = !mensagem;
}

function limparErros() {
    for (const el of form.querySelectorAll('[data-erro-para], [data-erro]')) el.textContent = '';
    for (const el of form.querySelectorAll('[aria-invalid]')) el.removeAttribute('aria-invalid');
    mostrarErroGeral(form, null);
}

// Cada chave de `campos` vai para o seu lugar: 'participantes.2.cpf' fica no cartão 3.
function mostrarErros(campos) {
    for (const [chave, mensagem] of Object.entries(campos)) {
        const partes = chave.match(/^participantes\.(\d+)\.(.+)$/);
        const cartao = partes ? cartoes()[Number(partes[1])] : null;
        const lugar = partes
            ? cartao?.querySelector(`[data-erro="${partes[2]}"]`)
            : form.querySelector(`[data-erro-para="${chave}"]`);
        if (!lugar) {
            mostrarErroGeral(form, mensagem);
            continue;
        }
        lugar.textContent = mensagem;
        const campo = partes ? cartao.querySelector(`[data-campo="${partes[2]}"]`) : form.elements[chave];
        campo?.setAttribute('aria-invalid', 'true');
    }
    const primeiro = form.querySelector('[aria-invalid="true"]')
        ?? [...form.querySelectorAll('[data-erro-para], [data-erro]')].find((el) => el.textContent);
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

// ---------- Quando ----------

function atualizarHorarios() {
    const data = form.elements.data.value;
    const seletor = form.elements.hora;
    const erroData = form.querySelector('[data-erro-para="data"]');
    const horarios = data ? horariosDoDia(data, opcoes.funcionamento) : [];
    erroData.textContent = data && horarios.length === 0 ? 'O estande não abre neste dia. Escolha outro.' : '';
    preencherSelect(seletor, horarios.map((h) => [h, `${doisDigitos(h)}:00`]), { vazio: 'Escolha o horário' });
    seletor.disabled = horarios.length === 0;
    atualizarDuracoes();
}

function atualizarDuracoes() {
    const data = form.elements.data.value;
    const hora = form.elements.hora.value === '' ? null : Number(form.elements.hora.value);
    const seletor = form.elements.horas;
    const { agenda, funcionamento } = opcoes;
    const maximo = cartoes().length > 1 ? agenda.duracao_maxima_grupo : agenda.duracao_maxima_individual;
    const duracoes = hora === null ? [] : duracoesPossiveis(data, hora, funcionamento, maximo);
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
    atualizarDuracoes();
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
        } else if (r.status === 401 || r.status === 403) {
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

// Até existir a lista (Task 7), o botão volta para um formulário novo.
document.getElementById('botao-ver-agendamentos').addEventListener('click', () => {
    montarFormulario();
    mostrarTela('tela-novo');
});

botaoAdicionar.addEventListener('click', adicionarParticipante);
form.elements.data.addEventListener('change', atualizarHorarios);
form.elements.hora.addEventListener('change', atualizarDuracoes);

// ---------- Início ----------

function montarFormulario() {
    const { estande, agenda, instrutores } = opcoes;
    form.reset();
    limparErros();
    pedidoAtual = null;
    const hoje = dataNoFuso(new Date(), estande.fuso);
    form.elements.data.min = hoje;
    form.elements.data.max = somarDias(hoje, agenda.antecedencia_maxima_dias);
    preencherSelect(form.elements.instrutor_id, instrutores.map((i) => [i.id, i.nome]), { vazio: 'Sem preferência' });
    form.elements.instrutor_id.value = '';
    listaParticipantes.replaceChildren();
    adicionarParticipante();
    atualizarHorarios();
}

async function iniciar() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return location.replace(ENTRAR);
    const r = await chamarFuncao('agendamentos', { consulta: 'ver=opcoes' });
    if (r.status === 401 || r.status === 403) return irParaEntrar();
    if (r.status !== 200) return avisar(r.dados?.erro ?? ERRO_PADRAO);
    opcoes = r.dados;
    document.getElementById('nome-estande').textContent = opcoes.estande.nome;
    montarFormulario();
    mostrarTela('tela-novo');
}

iniciar().catch((erro) => {
    console.error(erro);
    avisar(ERRO_PADRAO);
});
