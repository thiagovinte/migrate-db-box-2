const logger = require('./logger');
const testConnections = require('./test-connections');
const extractSchemas = require('./extract-schema');
const migrate = require('./migrate');

async function main() {
  logger.info('🚀 Iniciando Migração SQL Server → MySQL');
  logger.info('=====================================');

  try {
    // 1. Testar conexões
    logger.info('📋 Etapa 1: Testando conexões...');
    await testConnections();

    // 2. Extrair schemas (opcional, se não existir)
    logger.info('📋 Etapa 2: Verificando schemas...');
    const schemasPath = require('path').join(__dirname, '..', 'schemas', 'complete-schema.json');
    const fs = require('fs');
    
    if (!fs.existsSync(schemasPath)) {
      logger.info('📝 Schemas não encontrados, extraindo...');
      await extractSchemas();
    } else {
      logger.info('✅ Schemas já existem, pulando extração');
    }

    // 3. Migrar dados
    logger.info('📋 Etapa 3: Migrando dados...');
    await migrate();

    logger.info('🎉 Migração completa finalizada com sucesso!');

  } catch (error) {
    logger.error('💥 Erro durante migração:', error);
    process.exit(1);
  }
}

// Menu de ajuda
function showHelp() {
  console.log(`
📦 Migração SQL Server → MySQL

Comandos disponíveis:
  node src/index.js                    - Migração completa
  node src/test-connections.js         - Testar conexões
  node src/extract-schema.js           - Extrair schemas das tabelas
  node src/migrate.js                  - Migrar todas as tabelas
  node src/migrate.js "tabela1,tabela2" - Migrar tabelas específicas

Exemplos:
  node src/migrate.js "Usuarios,Produtos"
  node src/migrate.js "DOM_Municipios"
  
Configuração:
  Configure as conexões no arquivo .env na raiz do projeto.
  
Logs:
  Os logs são salvos na pasta /logs
  `);
}

// Processar argumentos da linha de comando
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  showHelp();
} else if (require.main === module) {
  main();
}

module.exports = { main, showHelp };