const DatabaseConnections = require('./database');
const logger = require('./logger');

async function testConnections() {
  const db = new DatabaseConnections();
  
  try {
    logger.info('🚀 Iniciando teste das conexões...');
    
    const success = await db.testConnections();
    
    if (success) {
      logger.info('🎉 Todas as conexões funcionando corretamente!');
    } else {
      logger.error('💥 Falha nos testes de conexão');
      process.exit(1);
    }
    
  } catch (error) {
    logger.error('💥 Erro durante teste:', error);
    process.exit(1);
  } finally {
    await db.closeAll();
  }
}

// Executar se chamado diretamente
if (require.main === module) {
  testConnections();
}

module.exports = testConnections;