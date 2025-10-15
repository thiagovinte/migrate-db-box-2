# Extração de Índices

Este diretório contém os índices extraídos do SQL Server e convertidos para MySQL.

## Arquivos Gerados

- **`indexes-export.json`** - Dados estruturados de todos os índices
- **`indexes-mysql.sql`** - Índices convertidos para MySQL
- **`indexes-sqlserver.sql`** - Índices originais do SQL Server

## Como Usar

### 1. Extrair índices do SQL Server
```bash
node src/extract-indexes.js
```

### 2. Aplicar índices no MySQL
```bash
# Depois de migrar todas as tabelas e dados
mysql -u usuario -p database < database-objects/indexes/indexes-mysql.sql
```

## Diferenças SQL Server vs MySQL

| SQL Server | MySQL | Observações |
|------------|-------|-------------|
| `NONCLUSTERED INDEX` | `INDEX` | MySQL não tem conceito de clustered/nonclustered |
| `CLUSTERED INDEX` | `INDEX` | Apenas uma primary key pode ser "clustered" no MySQL |
| `INCLUDE (columns)` | **Não suportado** | Comentado no SQL convertido |
| `WHERE condition` | **Limitado** | Filtered indexes não suportados diretamente |
| `[brackets]` | `` `backticks` `` | Convenção de escape diferente |

## Ordem de Execução Recomendada

1. **Criar todas as tabelas** primeiro
2. **Migrar todos os dados** 
3. **Aplicar índices** (este passo)
4. **Testar performance**

## Monitoramento

Durante a criação dos índices:
- Monitore uso de CPU e I/O
- Índices grandes podem demorar horas
- Execute em horário de baixo uso
- Considere executar índices por tabela gradualmente

## Troubleshooting

- **Erro "Unknown column"**: Verifique se a coluna existe na tabela MySQL
- **Erro "Duplicate key"**: Pode haver dados duplicados, use `IGNORE` temporariamente
- **Performance lenta**: Índices grandes demoram, seja paciente