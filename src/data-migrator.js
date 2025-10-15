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

  // Verificar status da migração e obter informações para migração incremental
  async checkMigrationStatus(tableName, expectedRows, identityColumn, schema) {
    try {
      const mysqlConn = await this.db.connectMySQL();
      const [result] = await mysqlConn.execute(
        `SELECT COUNT(*) as count FROM \`${tableName}\``
      );
      const currentRows = parseInt(result[0].count);
      
      // Verificar se existe coluna updatedAt
      const updatedAtColumn = schema.columns.find(col => 
        col.column_name.toLowerCase().includes('updatedat') || 
        col.column_name.toLowerCase().includes('updated_at') ||
        col.column_name.toLowerCase().includes('dataalteracao') ||
        col.column_name.toLowerCase().includes('datamodificacao')
      );
      
      if (currentRows === 0) {
        return { 
          status: 'empty', 
          currentRows, 
          expectedRows, 
          lastId: null, 
          lastUpdatedAt: null,
          updatedAtColumn: updatedAtColumn?.column_name || null
        };
      }
      
      let lastId = null;
      let lastUpdatedAt = null;
      
      // Obter último ID se existe coluna identity
      if (identityColumn) {
        const [lastIdResult] = await mysqlConn.execute(
          `SELECT MAX(\`${identityColumn.column_name}\`) as lastId FROM \`${tableName}\``
        );
        lastId = lastIdResult[0].lastId;
      }
      
      // Obter último updatedAt se existe coluna de update
      if (updatedAtColumn) {
        try {
          const [lastUpdatedResult] = await mysqlConn.execute(
            `SELECT MAX(\`${updatedAtColumn.column_name}\`) as lastUpdatedAt FROM \`${tableName}\``
          );
          lastUpdatedAt = lastUpdatedResult[0].lastUpdatedAt;
        } catch (error) {
          logger.warn(`⚠️  Não foi possível obter último updatedAt para ${tableName}: ${error.message}`);
        }
      }
      
      return { 
        status: currentRows >= expectedRows ? 'needs_sync' : 'partial', 
        currentRows, 
        expectedRows, 
        lastId,
        lastUpdatedAt,
        updatedAtColumn: updatedAtColumn?.column_name || null
      };
      
    } catch (error) {
      if (error.code === 'ER_NO_SUCH_TABLE') {
        return { 
          status: 'no_table', 
          currentRows: 0, 
          expectedRows, 
          lastId: null, 
          lastUpdatedAt: null,
          updatedAtColumn: null
        };
      }
      throw error;
    }
  }

  // Obter contagem real de registros no SQL Server
  async getActualRowCount(tableName) {
    try {
      const sqlPool = await this.db.connectSqlServer();
      const result = await sqlPool.request().query(`SELECT COUNT(*) as count FROM ${tableName}`);
      return parseInt(result.recordset[0].count);
    } catch (error) {
      logger.warn(`⚠️  Não foi possível obter contagem real de ${tableName}: ${error.message}`);
      return null;
    }
  }

  // Construir query incremental inteligente
  async buildIncrementalQuery(tableName, schema, migrationStatus, identityColumn) {
    const { lastId, lastUpdatedAt, updatedAtColumn, status } = migrationStatus;
    
    let whereConditions = [];
    let orderBy = '';
    
    // Se tem coluna identity, usar para buscar registros novos
    if (identityColumn && lastId) {
      whereConditions.push(`${identityColumn.column_name} > ${lastId}`);
    }
    
    // Se tem coluna de update, buscar registros atualizados
    if (updatedAtColumn && lastUpdatedAt) {
      const formattedDate = lastUpdatedAt.toISOString().slice(0, 19).replace('T', ' ');
      whereConditions.push(`${updatedAtColumn} > '${formattedDate}'`);
    }
    
    // Para status 'needs_sync', sempre verificar atualizações mesmo se não há novos registros
    if (status === 'needs_sync' && updatedAtColumn && lastUpdatedAt) {
      const formattedDate = lastUpdatedAt.toISOString().slice(0, 19).replace('T', ' ');
      whereConditions = [`${updatedAtColumn} > '${formattedDate}'`];
    }
    
    // Construir ORDER BY
    if (identityColumn) {
      orderBy = `ORDER BY ${identityColumn.column_name}`;
    } else if (updatedAtColumn) {
      orderBy = `ORDER BY ${updatedAtColumn}`;
    } else {
      orderBy = `ORDER BY ${schema.columns[0].column_name}`;
    }
    
    // Construir WHERE clause
    let whereClause = '';
    if (whereConditions.length > 0) {
      // Se tem tanto ID quanto updatedAt, usar OR para pegar registros novos OU atualizados
      if (whereConditions.length > 1 && identityColumn && updatedAtColumn) {
        whereClause = `WHERE (${whereConditions.join(' OR ')})`;
      } else {
        whereClause = `WHERE ${whereConditions.join(' AND ')}`;
      }
    }
    
    // Query final
    const query = `
      SELECT * FROM ${tableName}
      ${whereClause}
      ${orderBy}
    `.trim();
    
    return query;
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
    const migrationStatus = await this.checkMigrationStatus(tableName, expectedRows, identityColumn, schema);
    
    switch (migrationStatus.status) {
      case 'needs_sync':
        logger.info(`🔄 ${tableName}: ${migrationStatus.currentRows}/${expectedRows} registros - VERIFICANDO ATUALIZAÇÕES`);
        break;
        
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
      
      // VALIDAÇÃO: Verificar se row_count está correto
      const actualRowCount = await this.getActualRowCount(tableName);
      if (actualRowCount !== expectedRows) {
        logger.warn(`⚠️  ${tableName}: Schema diz ${expectedRows} registros, mas SQL Server tem ${actualRowCount}`);
        logger.info(`📊 Usando contagem real: ${actualRowCount} registros`);
        expectedRows = actualRowCount; // Atualizar com valor real
      }
      
      // Construir query inteligente baseada no status da migração
      const query = await this.buildIncrementalQuery(tableName, schema, migrationStatus, identityColumn);
      
      logger.info(`🔍 Buscando registros novos/atualizados: ${query.replace(/\s+/g, ' ').trim()}`);
      logger.info(`📊 Critérios: lastId=${migrationStatus.lastId}, lastUpdatedAt=${migrationStatus.lastUpdatedAt}`);

      const result = await sqlPool.request().query(query);
      const rows = result.recordset;

      if (rows.length === 0) {
        logger.info(`✅ Nenhum registro novo para migrar em ${tableName}`);
        return;
      }

      // Preparar dados para inserção/atualização
      const columns = schema.columns.map(col => col.column_name);
      const placeholders = columns.map(() => '?').join(', ');
      
      // Usar UPSERT (INSERT ... ON DUPLICATE KEY UPDATE) para lidar com registros atualizados
      let insertSQL;
      if (identityColumn) {
        // Para tabelas com identity, usar UPSERT para permitir atualizações
        const updateColumns = columns
          .filter(col => col !== identityColumn.column_name) // Não atualizar o ID
          .map(col => `\`${col}\` = VALUES(\`${col}\`)`)
          .join(', ');
          
        if (migrationStatus.status === 'needs_sync' && updateColumns) {
          // Se é sincronização, usar UPSERT para atualizar registros existentes
          insertSQL = `INSERT INTO \`${tableName}\` (\`${columns.join('`, `')}\`) VALUES (${placeholders}) 
                       ON DUPLICATE KEY UPDATE ${updateColumns}`;
        } else {
          // Se é migração inicial, usar INSERT IGNORE
          insertSQL = `INSERT IGNORE INTO \`${tableName}\` (\`${columns.join('`, `')}\`) VALUES (${placeholders})`;
        }
      } else {
        insertSQL = `INSERT INTO \`${tableName}\` (\`${columns.join('`, `')}\`) VALUES (${placeholders})`;
      }

      // VALIDAÇÃO: Verificar se há registros para processar
      const totalRows = rows.length;
      if (totalRows === 0) {
        logger.info(`✅ Nenhum registro novo para migrar em ${tableName}`);
        return;
      }
      
      // VALIDAÇÃO: Limite de segurança para evitar loops infinitos
      if (totalRows > expectedRows * 2) {
        logger.error(`🚨 ERRO: Muitos registros retornados (${totalRows}) para ${tableName}. Esperado: max ${expectedRows * 2}`);
        throw new Error(`Possível loop infinito ou query incorreta para ${tableName}`);
      }
      
      logger.info(`📦 Processando ${totalRows} registros de ${tableName}`);
      
      let processedInBatch = 0;
      let insertedCount = 0;
      let updatedCount = 0;

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
            const result = await mysqlConn.execute(insertSQL, values);

            // Verificar se foi inserção ou atualização
            const wasInserted = result[0].affectedRows > 0 && result[0].changedRows === 0;
            const wasUpdated = result[0].changedRows > 0;
            
            if (wasInserted || wasUpdated) {
              processedInBatch++;
              
              // Contar tipos de operação
              if (wasInserted) insertedCount++;
              if (wasUpdated) updatedCount++;
              
              // Se inseriu com sucesso e tem identity, mapear IDs (apenas para inserções)
              if (identityColumn && oldId && wasInserted) {
                const [newIdResult] = await mysqlConn.execute('SELECT LAST_INSERT_ID() as newId');
                const newId = newIdResult[0].newId;
                
                if (newId && newId !== oldId) {
                  this.idMappings.set(`${tableName}.${oldId}`, newId);
                }
              }
              
              // Log detalhado para atualizações
              if (wasUpdated && migrationStatus.updatedAtColumn) {
                const updatedValue = row[migrationStatus.updatedAtColumn];
                logger.debug(`🔄 Atualizado: ${tableName}.${oldId} (${migrationStatus.updatedAtColumn}: ${updatedValue})`);
              }
            }

          } catch (insertError) {
            if (!insertError.message.includes('Duplicate entry')) {
              logger.error(`❌ Erro ao inserir/atualizar registro em ${tableName}:`, insertError.message);
            }
          }
        }

        // Log progresso para cada lote
        const totalMigrated = migratedRows + processedInBatch;
        const progress = Math.min(((totalMigrated / expectedRows) * 100), 100).toFixed(1);
        
        // Aviso se está migrando mais que o esperado
        if (totalMigrated > expectedRows) {
          logger.warn(`⚠️  ${tableName}: Migrando mais registros que esperado! ${totalMigrated}/${expectedRows}`);
        }
        
        logger.info(`📈 ${tableName}: ${totalMigrated}/${expectedRows} (${progress}%)`);
      }

      const finalMigrated = migratedRows + processedInBatch;
      
      // Log com estatísticas detalhadas
      if (migrationStatus.status === 'needs_sync') {
        logger.info(`✅ Sincronização concluída: ${tableName} - ${processedInBatch} registros processados`);
        logger.info(`   📊 Inserções: ${insertedCount} | Atualizações: ${updatedCount}`);
      } else {
        logger.info(`✅ Migração concluída: ${tableName} - ${processedInBatch} novos registros (total: ${finalMigrated})`);
      }
      
      if (processedInBatch > 0 && migrationStatus.updatedAtColumn) {
        logger.info(`📅 Coluna de update detectada: ${migrationStatus.updatedAtColumn}`);
      }
      
      // VALIDAÇÃO FINAL: Verificar se não migrou mais que o esperado
      if (finalMigrated > expectedRows) {
        logger.warn(`⚠️  ATENÇÃO: ${tableName} migrou ${finalMigrated} registros, mas esperava ${expectedRows}`);
        logger.warn(`   Isso pode indicar duplicatas ou dados crescendo no SQL Server`);
      }

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