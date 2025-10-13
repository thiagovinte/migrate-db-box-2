const DatabaseConnections = require('./database');
const logger = require('./logger');
const fs = require('fs').promises;
const path = require('path');

class DataMigrator {
  constructor() {
    this.db = new DatabaseConnections();
    this.idMappings = new Map(); // Armazenar mapeamento de IDs antigos -> novos
    this.batchSize = 1000; // Processar em lotes de 1000 registros
  }

  async loadSchema() {
    const schemaPath = path.join(__dirname, '..', 'schemas', 'complete-schema.json');
    const schemaData = await fs.readFile(schemaPath, 'utf8');
    return JSON.parse(schemaData);
  }

  // Criar tabelas no MySQL
  async createTables(schemas) {
    const mysqlConn = await this.db.connectMySQL();
    
    // Ordenar tabelas por dependência (tabelas menores primeiro)
    const sortedTables = Object.entries(schemas)
      .sort(([,a], [,b]) => a.row_count - b.row_count)
      .map(([name]) => name);

    for (const tableName of sortedTables) {
      try {
        logger.info(`🔨 Criando tabela: ${tableName}`);
        
        // Desabilitar auto_increment temporariamente se necessário
        const createSQL = schemas[tableName].create_sql;
        await mysqlConn.execute(createSQL);
        
        logger.info(`✅ Tabela criada: ${tableName}`);
      } catch (error) {
        if (error.message.includes('already exists')) {
          logger.info(`⚠️  Tabela já existe: ${tableName}`);
        } else {
          logger.error(`❌ Erro ao criar tabela ${tableName}:`, error.message);
          throw error;
        }
      }
    }
  }

  // Verificar se tabela já foi migrada
  async checkMigrationStatus(tableName, expectedRows, identityColumn) {
    try {
      const mysqlConn = await this.db.connectMySQL();
      const [result] = await mysqlConn.execute(
        `SELECT COUNT(*) as count FROM \`${tableName}\``
      );
      const currentRows = parseInt(result[0].count);
      
      if (currentRows === 0) {
        return { status: 'empty', currentRows, expectedRows, lastId: null };
      }
      
      if (currentRows >= expectedRows) {
        return { status: 'completed', currentRows, expectedRows, lastId: null };
      }
      
      // Se tem alguns dados mas não todos, verificar qual foi o último ID migrado
      if (currentRows > 0 && currentRows < expectedRows && identityColumn) {
        const [lastIdResult] = await mysqlConn.execute(
          `SELECT MAX(\`${identityColumn.column_name}\`) as lastId FROM \`${tableName}\``
        );
        const lastId = lastIdResult[0].lastId;
        return { status: 'partial', currentRows, expectedRows, lastId };
      }
      
      return { status: 'pending', currentRows, expectedRows, lastId: null };
    } catch (error) {
      if (error.code === 'ER_NO_SUCH_TABLE') {
        return { status: 'no_table', currentRows: 0, expectedRows, lastId: null };
      }
      throw error;
    }
  }

  // Migrar dados de uma tabela
  async migrateTable(tableName, schema) {
    const expectedRows = parseInt(schema.row_count);
    
    if (expectedRows === 0) {
      logger.info(`⏭️  Pulando tabela vazia: ${tableName}`);
      return;
    }

    // Identificar colunas identity
    const identityColumn = schema.columns.find(col => col.is_identity);

    // Verificar status da migração
    const migrationStatus = await this.checkMigrationStatus(tableName, expectedRows, identityColumn);
    
    switch (migrationStatus.status) {
      case 'completed':
        logger.info(`✅ ${tableName}: ${migrationStatus.currentRows}/${expectedRows} registros - COMPLETA`);
        return;
        
      case 'partial':
        logger.info(`⚠️  ${tableName}: ${migrationStatus.currentRows}/${expectedRows} registros - CONTINUANDO...`);
        if (migrationStatus.lastId) {
          logger.info(`🔄 Retomando migração a partir do ID ${migrationStatus.lastId}`);
        }
        break;
        
      case 'empty':
      case 'no_table':
        logger.info(`🚚 ${tableName}: 0/${expectedRows} registros - INICIANDO MIGRAÇÃO`);
        break;
        
      default:
        logger.info(`🚚 ${tableName}: ${migrationStatus.currentRows}/${expectedRows} registros - CONTINUANDO`);
    }

    const sqlPool = await this.db.connectSqlServer();
    const mysqlConn = await this.db.connectMySQL();
    
    try {
      let migratedRows = migrationStatus.currentRows || 0;
      let whereClause = '';
      
      // Para migrações parciais com identity, buscar apenas registros após o último ID migrado
      if (migrationStatus.status === 'partial' && migrationStatus.lastId && identityColumn) {
        whereClause = `WHERE ${identityColumn.column_name} > ${migrationStatus.lastId}`;
      }

      // Buscar dados do SQL Server usando query baseada em cursor ao invés de OFFSET
      let query;
      if (identityColumn) {
        query = `
          SELECT * FROM ${tableName}
          ${whereClause}
          ORDER BY ${identityColumn.column_name}
        `;
      } else {
        // Se não tem identity, usar OFFSET tradicional (menos eficiente)
        const offset = migrationStatus.currentRows || 0;
        query = `
          SELECT * FROM ${tableName}
          ORDER BY ${schema.columns[0].column_name}
          OFFSET ${offset} ROWS
          FETCH NEXT ${expectedRows - offset} ROWS ONLY
        `;
      }

      const result = await sqlPool.request().query(query);
      const rows = result.recordset;

      if (rows.length === 0) {
        logger.info(`✅ Nenhum registro novo para migrar em ${tableName}`);
        return;
      }

      // Preparar dados para inserção
      const columns = schema.columns.map(col => col.column_name);
      const placeholders = columns.map(() => '?').join(', ');
      
      // Se tem identity, usar INSERT IGNORE para evitar conflitos de ID
      let insertSQL;
      if (identityColumn) {
        insertSQL = `INSERT IGNORE INTO \`${tableName}\` (\`${columns.join('`, `')}\`) VALUES (${placeholders})`;
      } else {
        insertSQL = `INSERT INTO \`${tableName}\` (\`${columns.join('`, `')}\`) VALUES (${placeholders})`;
      }

      // Processar registros em lotes
      const totalRows = rows.length;
      let processedInBatch = 0;

      for (let i = 0; i < totalRows; i += this.batchSize) {
        const batch = rows.slice(i, i + this.batchSize);
        
        // Inserir lote no MySQL
        for (const row of batch) {
          try {
            const values = columns.map(col => {
              let value = row[col];
              
              // Tratar valores especiais
              if (value === null || value === undefined) {
                return null;
              }
              
              // Tratar datas
              if (value instanceof Date) {
                return value.toISOString().slice(0, 19).replace('T', ' ');
              }
              
              // Tratar booleanos
              if (typeof value === 'boolean') {
                return value ? 1 : 0;
              }
              
              return value;
            });

            const oldId = identityColumn ? row[identityColumn.column_name] : null;
            await mysqlConn.execute(insertSQL, values);

            // Se inseriu com sucesso e tem identity, mapear IDs
            if (identityColumn && oldId) {
              const [newIdResult] = await mysqlConn.execute('SELECT LAST_INSERT_ID() as newId');
              const newId = newIdResult[0].newId;
              
              if (newId && newId !== oldId) {
                this.idMappings.set(`${tableName}.${oldId}`, newId);
              }
            }

            processedInBatch++;

          } catch (insertError) {
            if (!insertError.message.includes('Duplicate entry')) {
              logger.error(`❌ Erro ao inserir registro em ${tableName}:`, insertError.message);
            }
          }
        }

        // Log progresso para cada lote
        const totalMigrated = migratedRows + processedInBatch;
        const progress = ((totalMigrated / expectedRows) * 100).toFixed(1);
        logger.info(`📈 ${tableName}: ${totalMigrated}/${expectedRows} (${progress}%)`);
      }

      const finalMigrated = migratedRows + processedInBatch;
      logger.info(`✅ Migração concluída: ${tableName} - ${processedInBatch} novos registros (total: ${finalMigrated})`);

    } catch (error) {
      logger.error(`❌ Erro na migração da tabela ${tableName}:`, error);
      throw error;
    }
  }

  // Salvar mapeamento de IDs
  async saveIdMappings() {
    const mappingPath = path.join(__dirname, '..', 'id-mappings.json');
    const mappingData = Object.fromEntries(this.idMappings);
    await fs.writeFile(mappingPath, JSON.stringify(mappingData, null, 2));
    logger.info(`💾 Mapeamento de IDs salvo: ${Object.keys(mappingData).length} mapeamentos`);
  }

  // Executar migração completa
  async migrateAll() {
    try {
      logger.info('🚀 Iniciando migração completa...');
      
      const schemas = await this.loadSchema();
      
      // 1. Criar tabelas
      await this.createTables(schemas);
      
      // 2. Migrar dados (tabelas menores primeiro)
      const sortedTables = Object.entries(schemas)
        .sort(([,a], [,b]) => a.row_count - b.row_count);

      for (const [tableName, schema] of sortedTables) {
        await this.migrateTable(tableName, schema);
      }

      // 3. Salvar mapeamentos
      await this.saveIdMappings();

      logger.info('🎉 Migração completa finalizada!');
      
    } catch (error) {
      logger.error('💥 Erro durante migração:', error);
      throw error;
    } finally {
      await this.db.closeAll();
    }
  }

  // Migrar apenas tabelas específicas
  async migrateTables(tableNames) {
    try {
      logger.info(`🚀 Iniciando migração de tabelas específicas: ${tableNames.join(', ')}`);
      
      const schemas = await this.loadSchema();
      
      // Criar tabelas se necessário
      const selectedSchemas = {};
      for (const tableName of tableNames) {
        if (schemas[tableName]) {
          selectedSchemas[tableName] = schemas[tableName];
        } else {
          logger.error(`❌ Tabela não encontrada: ${tableName}`);
          return;
        }
      }

      await this.createTables(selectedSchemas);

      // Migrar dados
      for (const tableName of tableNames) {
        await this.migrateTable(tableName, schemas[tableName]);
      }

      await this.saveIdMappings();

      logger.info('🎉 Migração de tabelas específicas finalizada!');
      
    } catch (error) {
      logger.error('💥 Erro durante migração:', error);
      throw error;
    } finally {
      await this.db.closeAll();
    }
  }
}

module.exports = DataMigrator;