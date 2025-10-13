const sql = require('mssql');
const mysql = require('mysql2/promise');
const { sqlServerConfig, mysqlConfig } = require('./config');
const logger = require('./logger');

class DatabaseConnections {
  constructor() {
    this.sqlServerPool = null;
    this.mysqlConnection = null;
  }

  async connectSqlServer() {
    try {
      if (!this.sqlServerPool) {
        logger.info('Conectando ao SQL Server...');
        this.sqlServerPool = await sql.connect(sqlServerConfig);
        logger.info('✅ Conectado ao SQL Server');
      }
      return this.sqlServerPool;
    } catch (error) {
      logger.error('❌ Erro ao conectar SQL Server:', error);
      throw error;
    }
  }

  async connectMySQL() {
    try {
      if (!this.mysqlConnection) {
        logger.info('Conectando ao MySQL...');
        this.mysqlConnection = await mysql.createConnection(mysqlConfig);
        logger.info('✅ Conectado ao MySQL');
      }
      return this.mysqlConnection;
    } catch (error) {
      logger.error('❌ Erro ao conectar MySQL:', error);
      throw error;
    }
  }

  async testConnections() {
    try {
      // Testar SQL Server
      const sqlPool = await this.connectSqlServer();
      const sqlResult = await sqlPool.request().query('SELECT 1 as test');
      logger.info('✅ Teste SQL Server OK:', sqlResult.recordset[0]);

      // Testar MySQL
      const mysqlConn = await this.connectMySQL();
      const [mysqlResult] = await mysqlConn.execute('SELECT 1 as test');
      logger.info('✅ Teste MySQL OK:', mysqlResult[0]);

      return true;
    } catch (error) {
      logger.error('❌ Erro nos testes de conexão:', error);
      return false;
    }
  }

  async closeSqlServer() {
    if (this.sqlServerPool) {
      await this.sqlServerPool.close();
      this.sqlServerPool = null;
      logger.info('🔒 Conexão SQL Server fechada');
    }
  }

  async closeMySQL() {
    if (this.mysqlConnection) {
      await this.mysqlConnection.end();
      this.mysqlConnection = null;
      logger.info('🔒 Conexão MySQL fechada');
    }
  }

  async closeAll() {
    await this.closeSqlServer();
    await this.closeMySQL();
  }
}

module.exports = DatabaseConnections;