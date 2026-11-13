-- Valores iniciais das Configurações (padrões das seções 6, 8 e 12 da spec).
-- Todos podem ser mudados depois pelo superadmin.

insert into public.configuracoes (chave, valor) values
('estande', '{"nome":"RangePass","logo_url":null,"endereco":"","contato":"","fuso":"America/Sao_Paulo"}'),
('funcionamento', '{"dias":{"0":{"abre":"08:00","fecha":"23:00"},"1":{"abre":"08:00","fecha":"23:00"},"2":{"abre":"08:00","fecha":"23:00"},"3":{"abre":"08:00","fecha":"23:00"},"4":{"abre":"08:00","fecha":"23:00"},"5":{"abre":"08:00","fecha":"23:00"},"6":{"abre":"08:00","fecha":"23:00"}},"datas_fechadas":[]}'),
('agenda', '{"antecedencia_minima_horas":24,"antecedencia_maxima_dias":15,"prazo_alteracao_horas":24,"duracao_maxima_individual":3,"duracao_maxima_grupo":6,"grupo_maximo":15,"faixas_instrutores":[{"ate":5,"instrutores":1},{"ate":10,"instrutores":2},{"ate":15,"instrutores":3}],"poucas_vagas":1,"tolerancia_nao_comparecimento_min":15}'),
('municao', '{"minima_por_participante":50}'),
('cadastro', '{"idade_minima":18}'),
('creditos', '{"validade_dias":365,"arrependimento_dias":7}');
