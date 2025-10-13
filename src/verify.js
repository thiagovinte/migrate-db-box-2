const DatabaseConnections = require('./database');
const logger = require('./logger');

async function verifyMigration(tableName) {
  const db = new DatabaseConnections();
  
  try {
    // Conectar aos bancos
    const sqlPool = await db.connectSqlServer();
    const mysqlConn = await db.connectMySQL();

    // Contar registros no SQL Server
    const sqlResult = await sqlPool.request().query(`SELECT COUNT(*) as count FROM ${tableName}`);
    const sqlCount = sqlResult.recordset[0].count;

    // Contar registros no MySQL
    const [mysqlResult] = await mysqlConn.execute(`SELECT COUNT(*) as count FROM \`${tableName}\``);
    const mysqlCount = mysqlResult[0].count;

    logger.info(`📊 Verificação: ${tableName}`);
    logger.info(`   SQL Server: ${sqlCount} registros`);
    logger.info(`   MySQL:      ${mysqlCount} registros`);

    if (sqlCount === mysqlCount) {
      logger.info(`✅ Migração OK: Counts iguais`);
    } else {
      logger.warn(`⚠️  Diferença: SQL Server=${sqlCount}, MySQL=${mysqlCount}`);
    }

    // Mostrar alguns registros de exemplo
    if (mysqlCount > 0) {
      const [sampleResult] = await mysqlConn.execute(`SELECT * FROM \`${tableName}\` LIMIT 3`);
      logger.info(`📝 Primeiros registros no MySQL:`);
      console.table(sampleResult);
    }

  } catch (error) {
    logger.error(`❌ Erro na verificação:`, error);
  } finally {
    await db.closeAll();
  }
}

// Executar se chamado diretamente
if (require.main === module) {
  const tableName = process.argv[2];
  if (!tableName) {
    logger.error('❌ Informe o nome da tabela para verificar');
    logger.info('Uso: node src/verify.js <nome_da_tabela>');
    process.exit(1);
  }
  
  verifyMigration(tableName);
}

module.exports = verifyMigration;