# 🚚 Migração SQL Server → MySQL

Sistema completo para migrar banco de dados de SQL Server para MySQL na Digital Ocean, com controle de IDs e migração faseada.

## 🚀 Início Rápido

```bash
# 1. Instalar dependências
npm install

# 2. Testar conexões
node src/test-connections.js

# 3. Ver fases de migração
node src/migrate-phases.js list

# 4. Executar migração segura (fases 1-2)
node src/migrate-phases.js safe
```

## 📋 Comandos Disponíveis

### Básicos
```bash
node src/test-connections.js         # Testar conexões
node src/extract-schema.js           # Extrair schemas (automático)
node src/migrate-phases.js list      # Ver todas as fases
```

### Migração por Fases
```bash
node src/migrate-phases.js 1         # Executar fase específica
node src/migrate-phases.js safe      # Fases 1-2 (seguro)
node src/migrate-phases.js all       # Fases 1-6 (parar antes da 7)
```

### Migração Manual
```bash
node src/migrate.js                           # Migrar tudo
node src/migrate.js "Usuarios,Produtos"       # Tabelas específicas
node src/verify.js DOM_Uf                     # Verificar migração
```

## 📊 Fases de Migração

### 🟢 **Fase 1: Tabelas de Referência** (SEGURO)
- **Tabelas:** DOM_*, configurações básicas
- **Volume:** ~6.5k registros
- **Tempo:** 2-5 min
- **Risco:** Baixo

### 🟢 **Fase 2: Configurações e Cadastros** (SEGURO)  
- **Tabelas:** Empresas, Perfis, Categorias, etc.
- **Volume:** ~200 registros
- **Tempo:** 2-3 min
- **Risco:** Baixo

### 🟡 **Fase 3: Produtos e Caixas** (MÉDIO)
- **Tabelas:** Produtos, Caixas + Produtos_Estoque_Historico (389k)
- **Volume:** ~391k registros
- **Tempo:** 15-20 min
- **Risco:** Médio

### 🟠 **Fase 4: Usuários** (MÉDIO-ALTO)
- **Tabelas:** Usuarios (104k), UsuariosContaDigital (104k)
- **Volume:** ~220k registros  
- **Tempo:** 10-15 min
- **Risco:** Médio-Alto

### 🟡 **Fase 5: Encomendas** (MÉDIO)
- **Tabelas:** Sistema de encomendas
- **Volume:** ~62k registros
- **Tempo:** 8-12 min
- **Risco:** Médio

### 🔴 **Fase 6: Registros Financeiros** (ALTO)
- **Tabelas:** Sistema financeiro (343k registros)
- **Tempo:** 20-30 min
- **Risco:** Alto

### 🔴🔴 **Fase 7: Transações Grandes** (MUITO ALTO)
- **Tabelas:** UsuariosContaDigitalTransacoes (757k), CaixasSorteios (362k), CaixasSorteiosSimulados (435k)
- **Volume:** 1.5M registros
- **Tempo:** 60-90 min
- **Risco:** Muito Alto

## 💡 Recomendações de Uso

### Para Desenvolvimento/Teste:
```bash
node src/migrate-phases.js safe    # Executar fases 1-2
```

### Para Produção:
```bash
# 1. Executar fases seguras
node src/migrate-phases.js safe

# 2. Fora do horário comercial
node src/migrate-phases.js 3
node src/migrate-phases.js 4  
node src/migrate-phases.js 5
node src/migrate-phases.js 6

# 3. Backup + madrugada
node src/migrate-phases.js 7
```

## 🔍 Verificação

```bash
# Verificar tabela específica
node src/verify.js Usuarios

# Logs em tempo real
tail -f logs/combined.log
```

## 📁 Estrutura

```
├── src/
│   ├── config.js              # Configurações de conexão
│   ├── database.js            # Gerenciador de conexões
│   ├── logger.js              # Sistema de logs
│   ├── schema-extractor.js    # Extrator de schemas
│   ├── data-migrator.js       # Motor de migração
│   ├── migrate-phases.js      # Migração faseada ⭐
│   ├── migrate.js             # Migração manual
│   └── verify.js              # Verificação
├── schemas/                   # Schemas extraídos
├── logs/                      # Logs da migração
├── id-mappings.json          # Mapeamento de IDs
└── .env                      # Configurações
```

## 🛡️ Segurança

- ✅ Processamento em lotes (1000 registros)
- ✅ Controle de IDs automático  
- ✅ Logs detalhados
- ✅ Verificação de integridade
- ✅ Migração faseada por risco
- ✅ Mapeamento de IDs antigos → novos

## 🆘 Troubleshooting

### Conexão MySQL SSL:
```bash
# Se der erro de SSL, verificar .env:
MYSQL_ENCRYPT=true
```

### Tabelas grandes lentas:
```bash
# Executar uma por vez
node src/migrate.js "UsuariosContaDigitalTransacoes"
```

### Verificar progresso:
```bash
# Monitorar logs
tail -f logs/combined.log
```

---

**⚡ Pronto para usar!** Comece com `node src/migrate-phases.js safe`# migrate-db-box-2
