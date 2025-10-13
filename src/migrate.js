const DataMigrator = require('./data-migrator');
const logger = require('./logger');

async function migrate() {
  // Verificar argumentos da linha de comando
  const args = process.argv.slice(2);
  const migrator = new DataMigrator();

  if (args.length > 0) {
    // Migrar tabelas específicas
    const tableNames = args[0].split(',').map(t => t.trim());
    logger.info(`🎯 Migrando tabelas específicas: ${tableNames.join(', ')}`);
    await migrator.migrateTables(tableNames);
  } else {
    // Migração completa
    logger.info('🌍 Iniciando migração completa...');
    await migrator.migrateAll();
  }
}

// Executar se chamado diretamente
if (require.main === module) {
  migrate().catch(error => {
    logger.error('💥 Erro na migração:', error);
    process.exit(1);
  });
}

module.exports = migrate;