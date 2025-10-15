const DatabaseConnections = require('./database');
const logger = require('./logger');
const fs = require('fs').promises;
const path = require('path');

class IndexExtractor {
  constructor() {
    this.db = new DatabaseConnections();
  }

  async extractIndexes() {
    try {
      logger.info('🔍 Iniciando extração de índices...');
      
      const sqlPool = await this.db.connectSqlServer();
      
      // Query para extrair todos os índices (exceto PKs e constraints)
      const indexesQuery = `
        SELECT 
            t.name AS table_name,
            i.name AS index_name,
            i.type_desc AS index_type,
            i.is_unique,
            i.is_primary_key,
            i.is_unique_constraint,
            i.filter_definition,
            STRING_AGG(
                CASE 
                    WHEN ic.is_descending_key = 1 THEN c.name + ' DESC'
                    ELSE c.name + ' ASC'
                END, 
                ', '
            ) WITHIN GROUP (ORDER BY ic.key_ordinal) AS columns,
            STRING_AGG(
                CASE 
                    WHEN ic.is_included_column = 1 THEN c.name
                    ELSE NULL
                END, 
                ', '
            ) AS included_columns
        FROM sys.indexes i
        INNER JOIN sys.tables t ON i.object_id = t.object_id
        INNER JOIN sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id
        INNER JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
        WHERE i.type > 0  -- Excluir heap (type = 0)
          AND i.is_primary_key = 0  -- Excluir primary keys
          AND i.is_unique_constraint = 0  -- Excluir unique constraints
          AND t.is_ms_shipped = 0  -- Excluir tabelas do sistema
        GROUP BY 
            t.name, 
            i.name, 
            i.type_desc, 
            i.is_unique, 
            i.is_primary_key, 
            i.is_unique_constraint, 
            i.filter_definition
        ORDER BY t.name, i.name;
      `;

      logger.info('📊 Executando query de extração de índices...');
      const result = await sqlPool.request().query(indexesQuery);
      const indexes = result.recordset;

      logger.info(`✅ Encontrados ${indexes.length} índices`);

      // Converter para formato estruturado
      const indexesByTable = {};
      const mysqlIndexes = [];

      for (const index of indexes) {
        const tableName = index.table_name;
        
        if (!indexesByTable[tableName]) {
          indexesByTable[tableName] = [];
        }

        const indexInfo = {
          table_name: tableName,
          index_name: index.index_name,
          index_type: index.index_type,
          is_unique: index.is_unique,
          columns: index.columns,
          included_columns: index.included_columns,
          filter_definition: index.filter_definition,
          original_sql: this.generateSqlServerIndexSQL(index),
          mysql_sql: this.convertToMySQLIndex(index)
        };

        indexesByTable[tableName].push(indexInfo);
        mysqlIndexes.push(indexInfo);
      }

      // Salvar arquivo JSON estruturado
      const indexData = {
        extracted_at: new Date().toISOString(),
        total_indexes: indexes.length,
        total_tables: Object.keys(indexesByTable).length,
        indexes_by_table: indexesByTable,
        all_indexes: mysqlIndexes
      };

      const outputDir = path.join(__dirname, '..', 'database-objects', 'indexes');
      await fs.mkdir(outputDir, { recursive: true });

      const jsonPath = path.join(outputDir, 'indexes-export.json');
      await fs.writeFile(jsonPath, JSON.stringify(indexData, null, 2));

      // Gerar arquivo SQL para MySQL
      const mysqlSQL = this.generateMySQLIndexFile(mysqlIndexes);
      const sqlPath = path.join(outputDir, 'indexes-mysql.sql');
      await fs.writeFile(sqlPath, mysqlSQL);

      // Gerar arquivo SQL original
      const originalSQL = this.generateOriginalIndexFile(mysqlIndexes);
      const originalPath = path.join(outputDir, 'indexes-sqlserver.sql');
      await fs.writeFile(originalPath, originalSQL);

      logger.info(`📁 Arquivos salvos:`);
      logger.info(`   - JSON: ${jsonPath}`);
      logger.info(`   - MySQL: ${sqlPath}`);
      logger.info(`   - SQL Server: ${originalPath}`);

      // Log estatísticas
      logger.info(`📈 Estatísticas:`);
      logger.info(`   - Total de índices: ${indexes.length}`);
      logger.info(`   - Tabelas com índices: ${Object.keys(indexesByTable).length}`);
      
      const typeStats = {};
      indexes.forEach(idx => {
        typeStats[idx.index_type] = (typeStats[idx.index_type] || 0) + 1;
      });
      
      logger.info(`   - Por tipo:`);
      Object.entries(typeStats).forEach(([type, count]) => {
        logger.info(`     * ${type}: ${count}`);
      });

      return indexData;

    } catch (error) {
      logger.error('❌ Erro ao extrair índices:', error);
      throw error;
    } finally {
      await this.db.closeAll();
    }
  }

  generateSqlServerIndexSQL(index) {
    let sql = '';
    
    if (index.is_unique) {
      sql += `CREATE UNIQUE ${index.index_type} INDEX [${index.index_name}]`;
    } else {
      sql += `CREATE ${index.index_type} INDEX [${index.index_name}]`;
    }
    
    sql += ` ON [${index.table_name}] (${index.columns})`;
    
    if (index.included_columns) {
      sql += ` INCLUDE (${index.included_columns})`;
    }
    
    if (index.filter_definition) {
      sql += ` WHERE ${index.filter_definition}`;
    }
    
    return sql;
  }

  convertToMySQLIndex(index) {
    let sql = '';
    
    // MySQL não tem NONCLUSTERED/CLUSTERED - usar apenas INDEX
    const indexType = index.is_unique ? 'UNIQUE INDEX' : 'INDEX';
    
    sql += `CREATE ${indexType} \`${index.index_name}\``;
    sql += ` ON \`${index.table_name}\` (`;
    
    // Converter colunas (MySQL usa backticks)
    const columns = index.columns.split(', ').map(col => {
      const [name, direction] = col.split(' ');
      return `\`${name}\`${direction === 'DESC' ? ' DESC' : ''}`;
    }).join(', ');
    
    sql += columns + ')';
    
    // MySQL não suporta INCLUDE - comentar
    if (index.included_columns) {
      sql += `; -- INCLUDE columns not supported in MySQL: ${index.included_columns}`;
    }
    
    // MySQL não suporta filtered indexes da mesma forma
    if (index.filter_definition) {
      sql += `; -- Filtered index not directly supported: WHERE ${index.filter_definition}`;
    }
    
    return sql;
  }

  generateMySQLIndexFile(indexes) {
    let sql = `-- Índices convertidos para MySQL\n`;
    sql += `-- Gerado automaticamente em ${new Date().toISOString()}\n`;
    sql += `-- Total de índices: ${indexes.length}\n\n`;
    
    sql += `-- ========================================\n`;
    sql += `-- INSTRUÇÕES IMPORTANTES\n`;
    sql += `-- ========================================\n`;
    sql += `/*\n`;
    sql += `ANTES DE EXECUTAR:\n`;
    sql += `1. Certifique-se que todas as tabelas foram criadas\n`;
    sql += `2. Certifique-se que os dados foram migrados\n`;
    sql += `3. Execute os índices em ordem de prioridade\n`;
    sql += `4. Monitore a performance durante a criação\n\n`;
    sql += `DIFERENÇAS DO SQL SERVER:\n`;
    sql += `- NONCLUSTERED/CLUSTERED não existe no MySQL\n`;
    sql += `- INCLUDE columns não suportado (comentado)\n`;
    sql += `- Filtered indexes não suportados diretamente\n`;
    sql += `- Alguns índices podem precisar de ajustes manuais\n`;
    sql += `*/\n\n`;

    // Agrupar por tabela
    const byTable = {};
    indexes.forEach(idx => {
      if (!byTable[idx.table_name]) {
        byTable[idx.table_name] = [];
      }
      byTable[idx.table_name].push(idx);
    });

    Object.entries(byTable).forEach(([tableName, tableIndexes]) => {
      sql += `-- ========================================\n`;
      sql += `-- Índices para tabela: ${tableName}\n`;
      sql += `-- ========================================\n\n`;

      tableIndexes.forEach(idx => {
        sql += `-- Índice: ${idx.index_name} (${idx.index_type})\n`;
        if (idx.filter_definition || idx.included_columns) {
          sql += `-- Original SQL Server: ${idx.original_sql}\n`;
        }
        sql += `${idx.mysql_sql};\n\n`;
      });
    });

    return sql;
  }

  generateOriginalIndexFile(indexes) {
    let sql = `-- Índices originais do SQL Server\n`;
    sql += `-- Gerado automaticamente em ${new Date().toISOString()}\n`;
    sql += `-- Total de índices: ${indexes.length}\n\n`;

    // Agrupar por tabela
    const byTable = {};
    indexes.forEach(idx => {
      if (!byTable[idx.table_name]) {
        byTable[idx.table_name] = [];
      }
      byTable[idx.table_name].push(idx);
    });

    Object.entries(byTable).forEach(([tableName, tableIndexes]) => {
      sql += `-- ========================================\n`;
      sql += `-- Índices para tabela: ${tableName}\n`;
      sql += `-- ========================================\n\n`;

      tableIndexes.forEach(idx => {
        sql += `-- ${idx.index_name} (${idx.index_type})\n`;
        sql += `${idx.original_sql};\n\n`;
      });
    });

    return sql;
  }
}

// Executar se chamado diretamente
if (require.main === module) {
  const extractor = new IndexExtractor();
  extractor.extractIndexes()
    .then((data) => {
      logger.info('🎉 Extração de índices concluída com sucesso!');
      process.exit(0);
    })
    .catch((error) => {
      logger.error('💥 Falha na extração de índices:', error);
      process.exit(1);
    });
}

module.exports = IndexExtractor;