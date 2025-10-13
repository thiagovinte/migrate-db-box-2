const SchemaExtractor = require('./schema-extractor');
const logger = require('./logger');

async function extractSchemas() {
  const extractor = new SchemaExtractor();
  
  try {
    logger.info('🚀 Iniciando extração dos schemas...');
    
    const schemas = await extractor.extractAllTables();
    
    logger.info(`✅ Extração concluída! ${Object.keys(schemas).length} tabelas processadas`);
    
    // Mostrar resumo
    const totalRows = Object.values(schemas).reduce((sum, table) => sum + table.row_count, 0);
    const totalSize = Object.values(schemas).reduce((sum, table) => sum + table.used_space_mb, 0);
    
    logger.info(`📊 Resumo: ${totalRows.toLocaleString()} registros, ${totalSize.toFixed(2)} MB`);
    
  } catch (error) {
    logger.error('💥 Erro durante extração:', error);
    process.exit(1);
  } finally {
    await extractor.db.closeAll();
  }
}

// Executar se chamado diretamente
if (require.main === module) {
  extractSchemas();
}

module.exports = extractSchemas;