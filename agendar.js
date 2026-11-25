// Página do cliente: "Meus agendamentos" (GET agendamentos), alterar horário e cancelar (PUT agendamentos)
// e o novo agendamento, montado só com o que o servidor manda (GET agendamentos?ver=opcoes),
// conferido com as mesmas regras do servidor e enviado (POST agendamentos).
import { supabase, chamarFuncao } from './api.mjs';
import {
    descreverSessao, modelosDaCategoria, municoesDoModelo, nomeDoCalibre,
    TEXTO_SITUACAO, separarAgendamentos, armaDoParticipante, municaoDoParticipante,
    textoSemAlteracao, linhasDoPreco, textoSemPrecos,
} from './agendar-regras.mjs';
import {
    validarPedido, validarNovoHorario, instrutoresNecessarios, partesNoFuso,
} from './supabase/functions/_shared/agendamento.mjs';
import { calcularPreco, formatarReais } from './supabase/functions/_shared/precos.mjs';
import { montarAgenda } from './agenda-regras.mjs';
import { criarAgenda } from './agenda-tela.mjs';

const ERRO_PADRAO = 'Não foi possível concluir agora. Tente de novo em instantes.';
const ENTRAR = 'conta.html?voltar=index.html';
// Só este 403 quer dizer "sem acesso". O 403 de prazo ("Faltam menos de N horas…") fica na tela, como aviso.
const CONTA_DESATIVADA = 'Sua conta está desativada. Procure o atendimento do estande.';
const ERRO_CARREGAR = 'Não foi possível carregar agora. Verifique a internet e tente de novo.';
// No erro do servidor, o campo do cartão que fica marcado não tem o mesmo nome da chave do erro.
const CAMPO_DO_ERRO = { aceite_termo_versao: 'aceite', arma_propria: 'arma_modelo' };
const PRECO_MUDOU = 'O preço mudou. Confira o novo valor e confirme de novo.';
const ERRO_DISPONIBILIDADE = 'Não foi possível ver os horários livres agora. Verifique a internet e tente de novo.';

const form = document.getElementById('form-agendar');
const listaParticipantes = document.getElementById('participantes');
const botaoAdicionar = document.getElementById('botao-adicionar');
const revisao = document.getElementById('revisao');
const formAlterar = document.getElementById('form-alterar');
const agendaVisual = criarAgenda(form.querySelector('[data-agenda]'), {
    aoMudar: () => {
        limparErrosDaAgenda(form);
        redesenhar();
    },
});
const agendaAlterar = criarAgenda(formAlterar.querySelector('[data-agenda]'), {
    aoMudar: () => {
        limparErrosDaAgenda(formAlterar);
        redesenharAlterar();
    },
});

let opcoes = null;          // resposta do GET ?ver=opcoes
let disponibilidade = null; // resposta do GET ?ver=disponibilidade (pistas e instrutores livres por hora)
// A mesma resposta, com ?agendamento=<id>: o horário do agendamento aberto no "Alterar" aparece livre.
let disponibilidadeAlterar = null;
let pedidoAtual = null;     // o que vai no POST, montado ao revisar
// Identifica um envio: a mesma chave em "Confirmar" repetidos faz o servidor devolver o agendamento
// já criado em vez de criar outro. Nasce ao abrir a revisão e é trocada ao voltar para o formulário.
let chaveEnvio = null;
let itemAlterando = null;   // o agendamento (Item do servidor) aberto em "Alterar horário"
// O preço que a pessoa está vendo (na revisão e no "Alterar horário"): o total dele vai no envio
// (preco_esperado_centavos), para o servidor conferir. null quando não deu para calcular aqui.
let precoAtual = null;
let precoAlterar = null;
// O preço que o servidor devolveu num 409 do "Alterar", com o horário a que ele se refere ('data|hora|horas').
// Enquanto a escolha for esse horário, a prévia mostra esse preço, não a estimativa daqui.
let precoDoServidor = null;

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
        const nomeCampo = partes ? (CAMPO_DO_ERRO[partes[2]] ?? partes[2]) : null;
        const campo = partes ? cartao.querySelector(`[data-campo="${nomeCampo}"]`) : f.elements[chave];
        // Os rádios da agenda (vários com o mesmo nome) não são um campo só: o erro fica só no texto.
        if (campo instanceof Element) campo.setAttribute('aria-invalid', 'true');
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

const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;

// ---------- Quando: a agenda visual (no novo agendamento e no "Alterar horário") ----------
// As cores dizem se ainda há pista e instrutor livres. A falta de arma e o CPF repetido só aparecem no Confirmar/Salvar.

const AGENDA_VAZIA = { dias: [], horas: [], duracoes: [], escolha: { data: null, hora: null, horas: null }, aviso: null, resumo: null };

// Ao mexer na agenda, os erros antigos de dia, horário e duração saem.
function limparErrosDaAgenda(f) {
    for (const el of f.querySelectorAll('[data-erro-para="data"], [data-erro-para="hora"], [data-erro-para="horas"]')) {
        el.textContent = '';
    }
}

// Busca a disponibilidade. Devolve { dados } (null se não vierem) ou { sair: true } quando a pessoa
// precisa entrar de novo (a página já está indo para o "entrar").
async function buscarDisponibilidade(consulta) {
    let r = null;
    try {
        r = await chamarFuncao('agendamentos', { consulta });
    } catch (erro) {
        console.error(erro);
    }
    if (r && precisaEntrar(r)) {
        await irParaEntrar();
        return { sair: true };
    }
    return { dados: r?.status === 200 && r.dados?.dias ? r.dados : null };
}

// No novo agendamento. Se não vier, a mensagem com o "Tentar de novo" aparece; a disponibilidade de antes
// (se havia) fica, com a escolha da pessoa, em vez de a agenda ser apagada.
async function carregarDisponibilidade() {
    agendaVisual.mostrarErro(null);
    const { dados, sair } = await buscarDisponibilidade('ver=disponibilidade');
    if (sair) return;
    if (dados) {
        disponibilidade = dados;
        return;
    }
    agendaVisual.mostrarErro(ERRO_DISPONIBILIDADE, async () => {
        await carregarDisponibilidade();
        redesenhar();
    });
}

// Repinta a agenda com o tamanho do grupo e o instrutor de agora; uma escolha que não cabe mais é desfeita, com o aviso.
function redesenhar() {
    if (!disponibilidade) return agendaVisual.desenhar(AGENDA_VAZIA);
    const instrutor = form.elements.instrutor_id.value;
    const contexto = {
        disponibilidade,
        opcoes,
        agora: new Date(),
        quantidade: cartoes().length,
        instrutorId: instrutor === '' ? null : idDe(opcoes.instrutores, instrutor),
    };
    agendaVisual.desenhar(montarAgenda(contexto, agendaVisual.escolha()));
}

// No "Alterar horário": o mesmo, para o agendamento aberto. `escolha` é a de começar (o horário atual).
async function carregarDisponibilidadeAlterar(escolha) {
    agendaAlterar.mostrarErro(null);
    const { dados, sair } = await buscarDisponibilidade(`ver=disponibilidade&agendamento=${itemAlterando.id}`);
    if (sair) return;
    if (dados) {
        disponibilidadeAlterar = dados;
        return;
    }
    agendaAlterar.mostrarErro(ERRO_DISPONIBILIDADE, async () => {
        const antes = agendaAlterar.escolha();
        await carregarDisponibilidadeAlterar(escolha);
        // Se a agenda estava vazia (a primeira busca falhou), volta a começar pelo horário atual.
        redesenharAlterar(antes.data === null ? escolha : antes);
    });
}

// O grupo e o instrutor são os do agendamento (o servidor manda); só o horário muda.
function redesenharAlterar(escolha = agendaAlterar.escolha()) {
    if (!disponibilidadeAlterar) {
        agendaAlterar.desenhar(AGENDA_VAZIA);
    } else {
        const { agendamento } = disponibilidadeAlterar;
        const contexto = {
            disponibilidade: disponibilidadeAlterar,
            opcoes,
            agora: new Date(),
            quantidade: agendamento.participantes,
            instrutorId: agendamento.instrutor_escolhido_id,
        };
        agendaAlterar.desenhar(montarAgenda(contexto, escolha));
    }
    atualizarValorAlterar();
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
        // Os números dos cartões mudam; um erro antigo ficaria no cartão errado.
        limparErrosDosCartoes();
        atualizarGrupo();
    });
    atualizarArmaDoEstande(cartao);
    atualizarModalidade(cartao);
    return cartao;
}

function limparErrosDosCartoes() {
    for (const cartao of cartoes()) {
        for (const el of cartao.querySelectorAll('[data-erro]')) el.textContent = '';
        for (const el of cartao.querySelectorAll('[aria-invalid]')) el.removeAttribute('aria-invalid');
    }
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
    redesenhar();
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

// Dia, hora e duração vêm da agenda (com um rádio só, form.elements.hora não seria uma lista).
function lerPedido() {
    const instrutor = form.elements.instrutor_id.value;
    const { data, hora, horas } = agendaVisual.escolha();
    return {
        data: data ?? '',
        hora,
        horas,
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
    document.getElementById('revisao-prazo').textContent =
        `Você pode alterar ou cancelar pelo app até ${agenda.prazo_alteracao_horas} horas antes do início. Depois disso, fale com o estande.`;

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
    mostrarPrecoMudou(false);
    mostrarTela('tela-revisar');
}

// Sem o valor da hora de pista o estande ainda não tem preços: nada é calculado aqui
// e o servidor recusa agendar e alterar o horário.
const temPrecos = () => textoSemPrecos(opcoes.precos) === null;

// Sem preços, avisa no alto do formulário e trava o botão de enviar, para a pessoa não preencher
// tudo à toa. Com preços, esconde o aviso e libera o botão.
function avisarSemPrecos(f) {
    const texto = textoSemPrecos(opcoes.precos);
    const aviso = f.querySelector('[data-sem-precos]');
    aviso.textContent = texto ?? '';
    aviso.hidden = !texto;
    f.querySelector('button[type="submit"]').disabled = Boolean(texto);
}

// O mesmo cálculo do servidor, com a tabela e o "hoje" que vieram nas opções.
function calcular(pedido) {
    return calcularPreco(pedido, opcoes.precos, { hoje: opcoes.hoje, fuso: opcoes.estande.fuso });
}

// A tabela "Valor" da revisão: os itens, o desconto e o total (a última linha, em destaque).
function mostrarValor(preco) {
    const tabela = document.getElementById('revisao-valor');
    tabela.hidden = !preco;
    if (!preco) return;
    const titulo = document.createElement('p');
    titulo.className = 'bloco-titulo';
    titulo.textContent = 'Valor';
    const linhas = linhasDoPreco(preco).map((l) => linhaDeDado(l.rotulo, l.valor));
    linhas.at(-1).classList.add('total');
    if (preco.desconto) linhas.at(-2).classList.add('desconto');
    tabela.replaceChildren(titulo, ...linhas);
}

function mostrarPrecoMudou(mudou) {
    const aviso = document.getElementById('revisao-preco-mudou');
    aviso.textContent = mudou ? PRECO_MUDOU : '';
    aviso.hidden = !mudou;
    if (mudou) aviso.scrollIntoView?.({ block: 'center' });
}

form.addEventListener('submit', (evento) => {
    evento.preventDefault();
    limparErros();
    avisar(null);
    const pedido = lerPedido();
    const { campos, pedido: conferido } = validarPedido(pedido, { agora: new Date(), opcoes });
    if (Object.keys(campos).length) return mostrarErros(campos);
    pedidoAtual = pedido;
    chaveEnvio = crypto.randomUUID();
    precoAtual = temPrecos() ? calcular(conferido) : null;
    mostrarRevisao(pedido, conferido.inicio);
    mostrarValor(precoAtual);
});

document.getElementById('botao-voltar').addEventListener('click', () => {
    chaveEnvio = null;
    mostrarTela('tela-novo');
});

// O termo mudou com a página aberta: busca o texto e a versão novos, mostra nos cartões e
// desmarca as caixas, para a pessoa ler e aceitar de novo. A mensagem de erro fica.
async function atualizarTermo() {
    const r = await chamarFuncao('agendamentos', { consulta: 'ver=opcoes' });
    if (precisaEntrar(r)) return irParaEntrar();
    if (r.status !== 200 || !r.dados?.termo) return;
    opcoes.termo = r.dados.termo;
    for (const cartao of cartoes()) {
        cartao.querySelector('[data-texto-termo]').textContent = opcoes.termo.texto;
        campo(cartao, 'aceite').checked = false;
    }
}

document.getElementById('botao-confirmar').addEventListener('click', () => {
    mostrarErroGeral(revisao, null);
    mostrarPrecoMudou(false);
    ocupado(revisao, async () => {
        const r = await chamarFuncao('agendamentos', {
            metodo: 'POST',
            corpo: { ...pedidoAtual, chave_envio: chaveEnvio, preco_esperado_centavos: precoAtual?.total_centavos ?? 0 },
        });
        // 201: criado agora. 200: o mesmo envio já tinha sido criado (clique repetido, rede que caiu).
        if (r.status === 201 || r.status === 200) {
            const ag = r.dados.agendamento;
            document.getElementById('sucesso-sessao').textContent = descreverSessao(ag.inicio, ag.horas, opcoes.estande.fuso);
            mostrarTela('tela-sucesso');
        } else if (precisaEntrar(r)) {
            await irParaEntrar();
        } else if (r.status === 400 && r.dados?.campos) {
            chaveEnvio = null;
            mostrarTela('tela-novo');
            limparErros();
            mostrarErros(r.dados.campos);
            if (Object.keys(r.dados.campos).some((chave) => chave.endsWith('.aceite_termo_versao'))) {
                await atualizarTermo();
            }
        } else if (r.status === 409 && r.dados?.preco) {
            // O preço mudou com a revisão aberta: mostra o novo e espera a pessoa confirmar de novo.
            // A chave de envio continua a mesma (nada foi gravado).
            precoAtual = r.dados.preco;
            mostrarValor(precoAtual);
            mostrarPrecoMudou(true);
        } else if (r.status === 409) {
            // Recusa por vaga (pista, instrutor, arma, CPF): o erro fica na revisão e a agenda é buscada
            // de novo, para que, ao voltar, ela já mostre o que está livre agora.
            mostrarErroGeral(revisao, r.dados?.erro ?? ERRO_PADRAO);
            await carregarDisponibilidade();
            redesenhar();
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
form.elements.instrutor_id.addEventListener('change', () => redesenhar());

document.getElementById('botao-novo-voltar').addEventListener('click', () => {
    avisar(null);
    mostrarTela('tela-lista');
});

// ---------- Meus agendamentos ----------

function cartaoDoAgendamento(a, agora) {
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

    // Agendamento feito antes dos preços: sem preço, sem a linha.
    if (a.preco) {
        const total = cartao.querySelector('[data-total]');
        const desconto = a.preco.desconto ? ` · ${a.preco.desconto.nome}` : '';
        total.textContent = `Total: ${formatarReais(a.preco.total_centavos)}${desconto}`;
        total.hidden = false;
    }

    // Quem decide se ainda dá para mexer é o servidor (pode_alterar); a tela não recalcula o prazo.
    if (a.pode_alterar) {
        cartao.querySelector('[data-acoes]').hidden = false;
        cartao.querySelector('[data-alterar]').addEventListener('click', () => ocupado(cartao, () => abrirAlterar(a)));
        cartao.querySelector('[data-cancelar]').addEventListener('click', () => cancelar(a, sessao, cartao));
    } else {
        const texto = textoSemAlteracao(a, agora);
        if (texto) {
            const prazo = cartao.querySelector('[data-prazo]');
            prazo.textContent = texto;
            prazo.hidden = false;
        }
    }
    return cartao;
}

function preencherSecao(nome, itens, agora) {
    document.getElementById(`lista-${nome}`).replaceChildren(...itens.map((a) => cartaoDoAgendamento(a, agora)));
    document.getElementById(`secao-${nome}`).hidden = itens.length === 0;
}

function mostrarLista(agendamentos) {
    const agora = new Date();
    const { proximos, anteriores } = separarAgendamentos(agendamentos, agora);
    preencherSecao('proximos', proximos, agora);
    preencherSecao('anteriores', anteriores, agora);
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

// Depois de alterar ou cancelar (que já deu certo): se a lista nova não vier, a pessoa volta
// para a lista antiga, sabendo que a mudança foi feita e que a lista está desatualizada.
async function recarregarDepoisDe(sucesso) {
    let r = null;
    try {
        r = await chamarFuncao('agendamentos');
    } catch (erro) {
        console.error(erro);
    }
    if (r && precisaEntrar(r)) return irParaEntrar();
    if (r?.status === 200) {
        mostrarLista(r.dados.agendamentos);
        mostrarTela('tela-lista');
        return avisar(sucesso, { sucesso: true });
    }
    mostrarTela('tela-lista');
    avisar(`${sucesso} Não foi possível atualizar a lista; recarregue a página.`);
}

document.getElementById('botao-novo').addEventListener('click', () => {
    avisar(null);
    ocupado(document.getElementById('tela-lista'), async () => {
        await montarFormulario();
        mostrarTela('tela-novo');
    });
});

// ---------- Alterar horário ----------

// Abre com a disponibilidade buscada agora e o horário atual marcado (ele aparece livre: o servidor
// não conta as reservas deste agendamento).
async function abrirAlterar(a) {
    itemAlterando = a;
    precoDoServidor = null;
    disponibilidadeAlterar = null;
    avisar(null);
    formAlterar.reset();
    limparErros(formAlterar);
    document.getElementById('alterar-atual').textContent =
        `Agora: ${descreverSessao(a.inicio, a.horas, opcoes.estande.fuso)}`;
    avisarSemPrecos(formAlterar);
    // O horário atual, no relógio do estande.
    const atual = partesNoFuso(new Date(a.inicio), opcoes.estande.fuso);
    const escolha = { data: atual.data, hora: atual.hora, horas: a.horas };
    await carregarDisponibilidadeAlterar(escolha);
    redesenharAlterar(escolha);
    mostrarTela('tela-alterar');
    mostrarDiaMarcado(formAlterar);
}

// No celular o dia marcado pode ficar fora da vista na faixa de dias: rola só a faixa (não a página) até ele.
function mostrarDiaMarcado(f) {
    const faixa = f.querySelector('[data-dias]');
    const dia = faixa.querySelector('input:checked')?.closest('label');
    if (!dia) return;
    const esquerda = dia.getBoundingClientRect().left - faixa.getBoundingClientRect().left;
    faixa.scrollLeft += esquerda - (faixa.clientWidth - dia.offsetWidth) / 2;
}

function lerNovoHorario() {
    const { data, hora, horas } = agendaAlterar.escolha();
    return { data: data ?? '', hora, horas };
}

const chaveDoHorario = ({ data, hora, horas }) => `${data}|${hora}|${horas}`;

// O agendamento gravado com o horário novo, no formato que o cálculo usa. O Item não traz os ids:
// o modelo e a munição são achados no catálogo pelo nome. Se algum não estiver lá (saiu do catálogo),
// devolve null: o servidor calcula e, se for diferente, devolve o valor certo para a pessoa conferir.
function pedidoDoAlterar(inicio, horas) {
    const { catalogo, agenda } = opcoes;
    const calibre = (id) => catalogo.calibres.find((c) => c.id === id)?.nome ?? null;
    const participantes = [];
    for (const p of itemAlterando.participantes) {
        const saida = { modalidade: p.modalidade, modelo_id: null, tipo_municao_id: null, municao_qtd: p.municao_qtd };
        if (p.modalidade === 'estande') {
            const m = catalogo.modelos.find((x) => x.marca === p.modelo?.marca && x.nome === p.modelo?.nome
                && calibre(x.calibre_id) === p.modelo?.calibre);
            if (!m) return null;
            saida.modelo_id = m.id;
        }
        if (p.modalidade !== 'tudo_proprio') {
            const t = catalogo.tipos_municao.find((x) => x.nome === p.tipo_municao?.nome
                && calibre(x.calibre_id) === p.tipo_municao?.calibre);
            if (!t) return null;
            saida.tipo_municao_id = t.id;
        }
        participantes.push(saida);
    }
    return {
        inicio,
        horas,
        instrutores_necessarios: instrutoresNecessarios(participantes.length, agenda.faixas_instrutores),
        participantes,
    };
}

// "Novo valor" do horário escolhido. Para o horário do último 409 de preço, vale o preço do servidor;
// para os outros, calcula aqui.
function atualizarValorAlterar() {
    const caixa = document.getElementById('alterar-valor');
    const valor = caixa.querySelector('[data-novo-valor]');
    const desconto = caixa.querySelector('[data-desconto]');
    const novo = lerNovoHorario();
    const doServidor = precoDoServidor?.chave === chaveDoHorario(novo) ? precoDoServidor.preco : null;
    precoAlterar = doServidor;
    if (!doServidor) {
        const { campos, inicio, horas } = validarNovoHorario(novo, {
            agora: new Date(), opcoes, quantidade: itemAlterando.participantes.length,
        });
        if (Object.keys(campos).length || !temPrecos()) {
            caixa.hidden = true;
            return;
        }
        const pedido = pedidoDoAlterar(inicio, horas);
        try {
            precoAlterar = pedido ? calcular(pedido) : null;
        } catch {
            precoAlterar = null;
        }
    }
    caixa.hidden = false;
    desconto.hidden = !precoAlterar?.desconto;
    if (!precoAlterar) {
        valor.textContent = 'O novo valor aparece ao salvar, antes de confirmar.';
        return;
    }
    valor.textContent = `Novo valor: ${formatarReais(precoAlterar.total_centavos)}`;
    if (precoAlterar.desconto) {
        desconto.textContent = `Com desconto: ${precoAlterar.desconto.nome}, − ${formatarReais(precoAlterar.desconto.valor_centavos)}`;
    }
}

document.getElementById('botao-alterar-voltar').addEventListener('click', () => {
    avisar(null);
    mostrarTela('tela-lista');
});

formAlterar.addEventListener('submit', (evento) => {
    evento.preventDefault();
    limparErros(formAlterar);
    avisar(null);
    const novo = lerNovoHorario();
    const { campos } = validarNovoHorario(novo, {
        agora: new Date(), opcoes, quantidade: itemAlterando.participantes.length,
    });
    if (Object.keys(campos).length) return mostrarErros(campos, formAlterar);
    ocupado(formAlterar, async () => {
        const r = await chamarFuncao('agendamentos', {
            metodo: 'PUT',
            corpo: {
                id: itemAlterando.id, acao: 'alterar_horario', ...novo,
                preco_esperado_centavos: precoAlterar?.total_centavos ?? 0,
            },
        });
        if (r.status === 200) return recarregarDepoisDe('Horário alterado.');
        if (precisaEntrar(r)) return irParaEntrar();
        if (r.status === 400 && r.dados?.campos) return mostrarErros(r.dados.campos, formAlterar);
        if (r.status === 409 && r.dados?.preco) {
            // O valor é outro: mostra o certo (guardado para este horário) e espera a pessoa salvar de novo.
            precoDoServidor = { chave: chaveDoHorario(novo), preco: r.dados.preco };
            atualizarValorAlterar();
            return avisar(PRECO_MUDOU);
        }
        avisar(r.dados?.erro ?? ERRO_PADRAO);   // 403 (prazo), 404, 409: aviso, e fica na tela
        if (r.status === 409) {
            // Recusa por vaga: a agenda é buscada de novo, para mostrar o que está livre agora.
            await carregarDisponibilidadeAlterar(novo);
            redesenharAlterar();
        }
    });
});

// ---------- Cancelar ----------

function cancelar(a, sessao, cartao) {
    if (!window.confirm(`Cancelar o agendamento de ${sessao}?`)) return;
    avisar(null);
    ocupado(cartao, async () => {
        const r = await chamarFuncao('agendamentos', { metodo: 'PUT', corpo: { id: a.id, acao: 'cancelar' } });
        if (r.status === 200) return recarregarDepoisDe('Agendamento cancelado.');
        if (precisaEntrar(r)) return irParaEntrar();
        avisar(r.dados?.erro ?? ERRO_PADRAO);   // 403 (prazo), 404, 409: aviso, e fica na lista
    });
}

// ---------- Início ----------

// Abre o formulário limpo, com a disponibilidade buscada agora.
async function montarFormulario() {
    const { instrutores } = opcoes;
    form.reset();
    limparErros();
    pedidoAtual = null;
    chaveEnvio = null;
    disponibilidade = null;
    preencherSelect(form.elements.instrutor_id, instrutores.map((i) => [i.id, i.nome]), { vazio: 'Sem preferência' });
    form.elements.instrutor_id.value = '';
    listaParticipantes.replaceChildren();
    adicionarParticipante();
    avisarSemPrecos(form);
    await carregarDisponibilidade();
    redesenhar();
}

// Se as opções ou a lista não vierem, a tela de erro mostra o motivo e o botão "Tentar de novo".
function mostrarErroCarregar(mensagem) {
    document.getElementById('erro-carregar-mensagem').textContent = mensagem ?? ERRO_CARREGAR;
    mostrarTela('tela-erro');
}

// A carga da página: opções (fuso, horários, nome) e lista, juntas, em paralelo.
async function carregar() {
    mostrarTela('tela-carregando');
    const [r, lista] = await Promise.all([
        chamarFuncao('agendamentos', { consulta: 'ver=opcoes' }),
        chamarFuncao('agendamentos'),
    ]);
    if (precisaEntrar(r) || precisaEntrar(lista)) return irParaEntrar();
    if (r.status !== 200) return mostrarErroCarregar(r.dados?.erro);
    if (lista.status !== 200) return mostrarErroCarregar(lista.dados?.erro);
    opcoes = r.dados;
    document.getElementById('nome-estande').textContent = opcoes.estande.nome;
    document.getElementById('nome-cliente').textContent = opcoes.responsavel.nome_completo;
    mostrarLista(lista.dados.agendamentos);
    mostrarTela('tela-lista');
}

// A mesma carga, com qualquer falha (rede caída, resposta estranha) indo para a tela de erro.
function carregarComErro() {
    return carregar().catch((erro) => {
        console.error(erro);
        mostrarErroCarregar(null);
    });
}

document.getElementById('botao-tentar-de-novo').addEventListener('click', () => {
    ocupado(document.getElementById('tela-erro'), carregarComErro);
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
