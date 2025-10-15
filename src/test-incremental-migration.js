const DataMigrator = require('./data-migrator');
const logger = require('./logger');

// Script de teste para migração incremental
// Este script demonstra como a migração funciona com IDs e updatedAt

async function testIncrementalMigration() {
  const migrator = new DataMigrator();
  
  try {
    logger.info('🧪 Testando migração incremental...');
    
    // Carregar schema
    const schemas = await migrator.loadSchema();
    
    // Listar tabelas com colunas de update
    logger.info('📋 Analisando tabelas para migração incremental:');
    
    for (const [tableName, schema] of Object.entries(schemas)) {
      // Identificar colunas importantes
      const identityColumn = schema.columns.find(col => col.is_identity);
      const updatedAtColumn = schema.columns.find(col => 
        col.column_name.toLowerCase().includes('updatedat') || 
        col.column_name.toLowerCase().includes('updated_at') ||
        col.column_name.toLowerCase().includes('dataalteracao') ||
        col.column_name.toLowerCase().includes('datamodificacao')
      );
      
      const hasIncremental = identityColumn || updatedAtColumn;
      
      if (hasIncremental) {
        logger.info(`✅ ${tableName}:`);
        if (identityColumn) {
          logger.info(`   - ID Column: ${identityColumn.column_name}`);
        }
        if (updatedAtColumn) {
          logger.info(`   - Update Column: ${updatedAtColumn.column_name}`);
        }
        logger.info(`   - Rows: ${schema.row_count}`);
      } else {
        logger.warn(`⚠️  ${tableName}: Sem colunas de controle incremental`);
      }
    }
    
    logger.info('\n🎯 Para testar a migração incremental:');
    logger.info('1. Execute migração inicial: node src/data-migrator.js');
    logger.info('2. Faça alterações no SQL Server');
    logger.info('3. Execute novamente: node src/data-migrator.js');
    logger.info('4. Apenas registros novos/atualizados serão migrados!');
    
  } catch (error) {
    logger.error('❌ Erro no teste:', error);
  }
}

// Função para mostrar query que seria executada
async function showQueryExample() {
  const migrator = new DataMigrator();
  
  try {
    const schemas = await migrator.loadSchema();
    
    // Exemplo com uma tabela que tenha ID e updatedAt
    for (const [tableName, schema] of Object.entries(schemas)) {
      const identityColumn = schema.columns.find(col => col.is_identity);
      const updatedAtColumn = schema.columns.find(col => 
        col.column_name.toLowerCase().includes('updatedat') || 
        col.column_name.toLowerCase().includes('updated_at') ||
        col.column_name.toLowerCase().includes('dataalteracao')
      );
      
      if (identityColumn && updatedAtColumn) {
        logger.info(`\n📄 Exemplo de query incremental para ${tableName}:`);
        
        // Simular status de migração
        const mockStatus = {
          lastId: 1000,
          lastUpdatedAt: new Date('2024-01-01T10:00:00'),
          updatedAtColumn: updatedAtColumn.column_name,
          status: 'needs_sync'
        };
        
        const query = await migrator.buildIncrementalQuery(tableName, schema, mockStatus, identityColumn);
        logger.info(query);
        
        logger.info('\n🔍 Esta query vai buscar:');
        logger.info(`- Registros com ${identityColumn.column_name} > 1000 (novos)`);
        logger.info(`- OU registros com ${updatedAtColumn.column_name} > 2024-01-01 10:00:00 (atualizados)`);
        
        break; // Mostrar apenas um exemplo
      }
    }
    
  } catch (error) {
    logger.error('❌ Erro ao gerar exemplo:', error);
  }
}

// Executar se chamado diretamente
if (require.main === module) {
  const args = process.argv.slice(2);
  
  if (args.includes('--query-example')) {
    showQueryExample();
  } else {
    testIncrementalMigration();
  }
}

module.exports = { testIncrementalMigration, showQueryExample };