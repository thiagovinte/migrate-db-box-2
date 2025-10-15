const DatabaseConnections = require('./database');
const logger = require('./logger');

// Script para diagnosticar problemas em tabelas específicas

class TableDiagnostic {
  constructor() {
    this.db = new DatabaseConnections();
  }

  async diagnoseTable(tableName) {
    try {
      logger.info(`🔍 Diagnosticando tabela: ${tableName}`);
      
      const sqlPool = await this.db.connectSqlServer();
      const mysqlConn = await this.db.connectMySQL();
      
      // 1. Contar registros no SQL Server
      const sqlServerCount = await this.getRowCount(sqlPool, tableName, 'SQL Server');
      
      // 2. Contar registros no MySQL
      const mysqlCount = await this.getRowCount(mysqlConn, tableName, 'MySQL');
      
      // 3. Verificar se há duplicatas no MySQL
      const duplicates = await this.checkDuplicates(mysqlConn, tableName);
      
      // 4. Comparar primeiros e últimos registros
      await this.compareDataSample(sqlPool, mysqlConn, tableName);
      
      // 5. Verificar estrutura da tabela
      await this.checkTableStructure(sqlPool, mysqlConn, tableName);
      
      // Resumo
      logger.info(`\n📊 RESUMO DIAGNÓSTICO - ${tableName}:`);
      logger.info(`   SQL Server: ${sqlServerCount} registros`);
      logger.info(`   MySQL: ${mysqlCount} registros`);
      logger.info(`   Diferença: ${mysqlCount - sqlServerCount} registros`);
      
      if (duplicates > 0) {
        logger.warn(`   ⚠️  Duplicatas no MySQL: ${duplicates}`);
      }
      
      if (mysqlCount > sqlServerCount) {
        logger.warn(`   🚨 MySQL tem MAIS registros que SQL Server!`);
        logger.warn(`   Possíveis causas:`);
        logger.warn(`   - Duplicatas durante migração`);
        logger.warn(`   - Dados crescendo no SQL Server durante migração`);
        logger.warn(`   - Bug na query de migração`);
      }
      
    } catch (error) {
      logger.error('❌ Erro no diagnóstico:', error);
    } finally {
      await this.db.closeAll();
    }
  }

  async getRowCount(connection, tableName, dbType) {
    try {
      let result;
      if (dbType === 'SQL Server') {
        result = await connection.request().query(`SELECT COUNT(*) as count FROM ${tableName}`);
        return parseInt(result.recordset[0].count);
      } else {
        const [rows] = await connection.execute(`SELECT COUNT(*) as count FROM \`${tableName}\``);
        return parseInt(rows[0].count);
      }
    } catch (error) {
      logger.error(`❌ Erro ao contar registros em ${dbType}:`, error.message);
      return 0;
    }
  }

  async checkDuplicates(mysqlConn, tableName) {
    try {
      // Verificar se há primary key
      const [pkInfo] = await mysqlConn.execute(`
        SELECT COLUMN_NAME 
        FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE 
        WHERE TABLE_SCHEMA = DATABASE() 
          AND TABLE_NAME = ? 
          AND CONSTRAINT_NAME = 'PRIMARY'
      `, [tableName]);
      
      if (pkInfo.length === 0) {
        logger.warn(`⚠️  ${tableName} não tem PRIMARY KEY - não é possível verificar duplicatas`);
        return 0;
      }
      
      const pkColumn = pkInfo[0].COLUMN_NAME;
      
      // Contar duplicatas
      const [duplicates] = await mysqlConn.execute(`
        SELECT COUNT(*) as duplicates
        FROM (
          SELECT \`${pkColumn}\`, COUNT(*) as cnt
          FROM \`${tableName}\`
          GROUP BY \`${pkColumn}\`
          HAVING COUNT(*) > 1
        ) dup
      `);
      
      const duplicateCount = parseInt(duplicates[0].duplicates);
      
      if (duplicateCount > 0) {
        logger.warn(`🔍 Encontradas ${duplicateCount} chaves duplicadas na coluna ${pkColumn}`);
        
        // Mostrar exemplos de duplicatas
        const [examples] = await mysqlConn.execute(`
          SELECT \`${pkColumn}\`, COUNT(*) as cnt
          FROM \`${tableName}\`
          GROUP BY \`${pkColumn}\`
          HAVING COUNT(*) > 1
          LIMIT 5
        `);
        
        logger.warn(`   Exemplos de IDs duplicados:`);
        examples.forEach(row => {
          logger.warn(`   - ${pkColumn}=${row[pkColumn]}: ${row.cnt} ocorrências`);
        });
      }
      
      return duplicateCount;
      
    } catch (error) {
      logger.error(`❌ Erro ao verificar duplicatas:`, error.message);
      return 0;
    }
  }

  async compareDataSample(sqlPool, mysqlConn, tableName) {
    try {
      logger.info(`🔍 Comparando amostras de dados...`);
      
      // Primeiros 5 registros SQL Server
      const sqlFirst = await sqlPool.request().query(`
        SELECT TOP 5 * FROM ${tableName} ORDER BY 1
      `);
      
      // Primeiros 5 registros MySQL
      const [mysqlFirst] = await mysqlConn.execute(`
        SELECT * FROM \`${tableName}\` ORDER BY 1 LIMIT 5
      `);
      
      // Últimos 5 registros SQL Server
      const sqlLast = await sqlPool.request().query(`
        SELECT TOP 5 * FROM ${tableName} ORDER BY 1 DESC
      `);
      
      // Últimos 5 registros MySQL
      const [mysqlLast] = await mysqlConn.execute(`
        SELECT * FROM \`${tableName}\` ORDER BY 1 DESC LIMIT 5
      `);
      
      logger.info(`📊 Primeiros registros:`);
      logger.info(`   SQL Server: ${sqlFirst.recordset.length} registros`);
      logger.info(`   MySQL: ${mysqlFirst.length} registros`);
      
      logger.info(`📊 Últimos registros:`);
      logger.info(`   SQL Server: ${sqlLast.recordset.length} registros`);
      logger.info(`   MySQL: ${mysqlLast.length} registros`);
      
      // Verificar se há diferenças nos IDs
      if (sqlFirst.recordset.length > 0 && mysqlFirst.length > 0) {
        const firstCol = Object.keys(sqlFirst.recordset[0])[0];
        const sqlFirstId = sqlFirst.recordset[0][firstCol];
        const mysqlFirstId = mysqlFirst[0][firstCol];
        
        logger.info(`🔢 Primeiro ID - SQL Server: ${sqlFirstId}, MySQL: ${mysqlFirstId}`);
        
        if (sqlLast.recordset.length > 0 && mysqlLast.length > 0) {
          const sqlLastId = sqlLast.recordset[0][firstCol];
          const mysqlLastId = mysqlLast[0][firstCol];
          
          logger.info(`🔢 Último ID - SQL Server: ${sqlLastId}, MySQL: ${mysqlLastId}`);
        }
      }
      
    } catch (error) {
      logger.error(`❌ Erro ao comparar amostras:`, error.message);
    }
  }

  async checkTableStructure(sqlPool, mysqlConn, tableName) {
    try {
      logger.info(`🏗️  Verificando estrutura da tabela...`);
      
      // Colunas SQL Server
      const sqlColumns = await sqlPool.request().query(`
        SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE 
        FROM INFORMATION_SCHEMA.COLUMNS 
        WHERE TABLE_NAME = '${tableName}'
        ORDER BY ORDINAL_POSITION
      `);
      
      // Colunas MySQL
      const [mysqlColumns] = await mysqlConn.execute(`
        SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE 
        FROM INFORMATION_SCHEMA.COLUMNS 
        WHERE TABLE_SCHEMA = DATABASE() 
          AND TABLE_NAME = ?
        ORDER BY ORDINAL_POSITION
      `, [tableName]);
      
      logger.info(`📋 Colunas:`);
      logger.info(`   SQL Server: ${sqlColumns.recordset.length} colunas`);
      logger.info(`   MySQL: ${mysqlColumns.length} colunas`);
      
      // Verificar se há diferenças
      if (sqlColumns.recordset.length !== mysqlColumns.length) {
        logger.warn(`⚠️  Número diferente de colunas!`);
      }
      
    } catch (error) {
      logger.error(`❌ Erro ao verificar estrutura:`, error.message);
    }
  }
}

// Executar se chamado diretamente
if (require.main === module) {
  const tableName = process.argv[2] || 'DOM_Municipios';
  
  const diagnostic = new TableDiagnostic();
  diagnostic.diagnoseTable(tableName)
    .then(() => {
      logger.info('🎉 Diagnóstico concluído!');
      process.exit(0);
    })
    .catch((error) => {
      logger.error('💥 Falha no diagnóstico:', error);
      process.exit(1);
    });
}

module.exports = TableDiagnostic;