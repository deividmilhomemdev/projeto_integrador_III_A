erDiagram
    tb_usuario ||--o{ tb_assistida : "acompanha (1:N)"
    tb_assistida ||--o{ tb_sessao : "possui (1:N)"

    tb_usuario {
        bigint id_usuario PK
        varchar nome_usuario
        varchar email
        varchar crp
        varchar contato
        varchar linkedin
        int acesso_adm "1 = Admin | 0 = Voluntaria"
    }

    tb_assistida {
        bigint id_assistida PK
        varchar nome
        varchar contato
        varchar status_atendimento
        bigint id_usuario FK "Ref: tb_usuario(id_usuario)"
    }

    tb_sessao {
        bigint id_sessao PK
        int numero_sessao
        date data_sessao
        time horario_sessao
        varchar indicadores
        boolean indicador_sessao_realizada
        boolean indicador_desistencia
        bigint id_assistida FK "Ref: tb_assistida(id_assistida)"
    }

    tb_informacoes {
        bigint id PK
        text titulo
        text descricao
        text tipo "texto | pdf | imagem"
        text url "Link ou Supabase Storage"
        text conteudo
        int ordem
    }