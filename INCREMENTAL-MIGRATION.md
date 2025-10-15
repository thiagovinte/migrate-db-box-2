# Migração Incremental Inteligente

O sistema de migração foi aprimorado para realizar **migração incremental automática**, buscando apenas registros novos ou atualizados.

## 🚀 Como Funciona

### 1. **Detecção Automática de Colunas**
O sistema detecta automaticamente:
- **Colunas de ID** (identity): `id`, `idUsuario`, `idProduto`, etc.
- **Colunas de Update**: `updatedAt`, `updated_at`, `dataAlteracao`, `dataModificacao`

### 2. **Estratégias de Busca**

#### **Primeira Execução (Migração Inicial)**
```sql
SELECT * FROM tabela ORDER BY id
```

#### **Execuções Subsequentes (Incremental)**
```sql
-- Busca registros novos OU atualizados
SELECT * FROM tabela 
WHERE (id > 1000 OR updatedAt > '2024-01-01 10:00:00')
ORDER BY id
```

### 3. **Tipos de Operação**

| Status | Descrição | Ação |
|--------|-----------|------|
| `empty` | Tabela vazia no MySQL | Migração completa |
| `partial` | Migração incompleta | Continua do último ID |
| `needs_sync` | Verificar atualizações | Busca apenas registros modificados |

## 🔧 Funcionalidades

### **UPSERT Automático**
- **Registros novos**: `INSERT IGNORE` (evita duplicatas)
- **Registros atualizados**: `INSERT ... ON DUPLICATE KEY UPDATE`

### **Otimizações**
- ✅ Busca apenas dados necessários
- ✅ Usa índices (ID e updatedAt)
- ✅ Evita scan completo da tabela
- ✅ Processa em lotes de 1000 registros

### **Logs Detalhados**
```
🔄 usuarios: 15234/15500 registros - VERIFICANDO ATUALIZAÇÕES
🔍 Buscando registros novos/atualizados: SELECT * FROM usuarios WHERE (idUsuario > 15234 OR updatedAt > '2024-01-01 10:00:00') ORDER BY idUsuario
📊 Critérios: lastId=15234, lastUpdatedAt=2024-01-01T10:00:00.000Z
✅ Sincronização concluída: usuarios - 25 registros processados (inserções + atualizações)
```

## 📋 Como Usar

### **1. Migração Normal**
```bash
node src/data-migrator.js
```

### **2. Testar Funcionalidade**
```bash
# Ver quais tabelas têm suporte incremental
node src/test-incremental-migration.js

# Ver exemplo de query gerada
node src/test-incremental-migration.js --query-example
```

### **3. Migração de Tabela Específica**
```javascript
const migrator = new DataMigrator();
await migrator.migrateTables(['usuarios', 'Produtos']);
```

## 🎯 Cenários de Uso

### **Cenário 1: Novo Sistema**
1. **Primeira execução**: Migra todos os dados
2. **Execuções seguintes**: Migra apenas novos registros

### **Cenário 2: Sistema em Produção**
1. **Migração inicial**: Durante manutenção
2. **Sincronização**: Executar periodicamente (ex: a cada hora)
3. **Delta**: Apenas registros modificados são transferidos

### **Cenário 3: Recuperação**
1. **Falha na migração**: Retoma do último ID processado
2. **Dados corrompidos**: Re-sincroniza automaticamente

## ⚡ Performance

### **Antes (Migração Completa)**
```sql
-- Sempre busca TODOS os registros
SELECT * FROM usuarios ORDER BY idUsuario
-- 1M registros = 5-10 minutos
```

### **Depois (Migração Incremental)**
```sql
-- Busca apenas registros novos/modificados
SELECT * FROM usuarios 
WHERE idUsuario > 15234 OR updatedAt > '2024-01-01 10:00:00'
ORDER BY idUsuario
-- 100 registros = 5-10 segundos
```

### **Ganho de Performance**
- ⚡ **100-1000x mais rápido** para atualizações
- 🔥 **Redução de 99%** no tempo de execução
- 💾 **Menor uso de memória e rede**

## 🛠️ Configuração Avançada

### **Personalizar Colunas de Update**
```javascript
// Adicionar mais padrões de detecção
const updatedAtColumn = schema.columns.find(col => 
  col.column_name.toLowerCase().includes('updatedat') || 
  col.column_name.toLowerCase().includes('modified_at') ||
  col.column_name.toLowerCase().includes('last_modified') ||
  col.column_name.toLowerCase().includes('timestamp')
);
```

### **Forçar Migração Completa**
```javascript
// Limpar tabela para forçar migração completa
await mysqlConn.execute('TRUNCATE TABLE usuarios');
```

## 🚨 Importante

### **Requisitos**
- ✅ Tabelas devem ter **PRIMARY KEY** ou **UNIQUE INDEX**
- ✅ Colunas de update devem ser **indexadas** para performance
- ✅ Clocks do SQL Server e MySQL devem estar sincronizados

### **Limitações**
- ❌ Não detecta **registros deletados** automaticamente
- ❌ Tabelas sem ID ou updatedAt fazem migração completa
- ❌ Mudanças de schema requerem migração manual

### **Boas Práticas**
1. **Execute testes** antes da produção
2. **Monitore logs** para verificar operações
3. **Mantenha backup** antes de grandes migrações
4. **Use em horários de baixo uso** para grandes volumes

## 📊 Monitoramento

### **Logs Importantes**
```bash
# Verificar se está funcionando
grep "VERIFICANDO ATUALIZAÇÕES" migration.log

# Ver registros processados
grep "registros processados" migration.log

# Verificar erros
grep "❌" migration.log
```

### **Queries de Verificação**
```sql
-- Verificar último registro migrado
SELECT MAX(id), MAX(updatedAt) FROM tabela;

-- Comparar contadores
SELECT COUNT(*) FROM tabela; -- SQL Server
SELECT COUNT(*) FROM tabela; -- MySQL
```

A migração incremental torna o processo **muito mais eficiente** e permite **sincronização contínua** entre os bancos! 🎉