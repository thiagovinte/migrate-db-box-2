const DatabaseConnections = require('./database');
const logger = require('./logger');
const fs = require('fs').promises;
const path = require('path');

class SchemaExtractor {
  constructor() {
    this.db = new DatabaseConnections();
  }

  // Mapear tipos SQL Server para MySQL
  mapDataType(sqlServerType, maxLength, precision, scale) {
    const typeMap = {
      'int': 'INT',
      'bigint': 'BIGINT',
      'smallint': 'SMALLINT',
      'tinyint': 'TINYINT',
      'bit': 'BOOLEAN',
      'decimal': `DECIMAL(${precision},${scale})`,
      'numeric': `DECIMAL(${precision},${scale})`,
      'money': 'DECIMAL(19,4)',
      'smallmoney': 'DECIMAL(10,4)',
      'float': 'DOUBLE',
      'real': 'FLOAT',
      'datetime': 'DATETIME',
      'datetime2': 'DATETIME',
      'date': 'DATE',
      'time': 'TIME',
      'datetimeoffset': 'TIMESTAMP',
      'varchar': maxLength === -1 ? 'TEXT' : `VARCHAR(${maxLength})`,
      'nvarchar': maxLength === -1 ? 'TEXT' : `VARCHAR(${maxLength / 2})`,
      'char': `CHAR(${maxLength})`,
      'nchar': `CHAR(${maxLength / 2})`,
      'text': 'TEXT',
      'ntext': 'TEXT',
      'uniqueidentifier': 'VARCHAR(36)'
    };

    return typeMap[sqlServerType] || 'TEXT';
  }

  async extractTableSchema(tableName) {
    const sqlPool = await this.db.connectSqlServer();
    
    const query = `
      SELECT 
        c.name AS column_name,
        ty.name AS data_type,
        c.max_length,
        c.precision,
        c.scale,
        c.is_nullable,
        c.is_identity,
        CASE 
          WHEN c.default_object_id != 0 THEN 
            (SELECT definition FROM sys.default_constraints WHERE object_id = c.default_object_id)
          ELSE NULL
        END AS default_value,
        -- Verificar se é chave primária
        CASE WHEN pk.column_name IS NOT NULL THEN 1 ELSE 0 END AS is_primary_key
      FROM sys.tables t
      INNER JOIN sys.columns c ON t.object_id = c.object_id
      INNER JOIN sys.types ty ON c.user_type_id = ty.user_type_id
      LEFT JOIN (
        SELECT 
          t.name AS table_name,
          c.name AS column_name
        FROM sys.tables t
        INNER JOIN sys.indexes i ON t.object_id = i.object_id
        INNER JOIN sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id
        INNER JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
        WHERE i.is_primary_key = 1
      ) pk ON t.name = pk.table_name AND c.name = pk.column_name
      WHERE t.name = @tableName AND t.is_ms_shipped = 0
      ORDER BY c.column_id
    `;

    const result = await sqlPool.request()
      .input('tableName', tableName)
      .query(query);

    return result.recordset;
  }

  generateCreateTableSQL(tableName, columns) {
    let sql = `CREATE TABLE IF NOT EXISTS \`${tableName}\` (\n`;
    
    const columnDefinitions = columns.map(col => {
      let definition = `  \`${col.column_name}\` ${this.mapDataType(col.data_type, col.max_length, col.precision, col.scale)}`;
      
      // NOT NULL
      if (!col.is_nullable) {
        definition += ' NOT NULL';
      }
      
      // AUTO_INCREMENT para identity
      if (col.is_identity) {
        definition += ' AUTO_INCREMENT';
      }
      
      // Default value (simplificado)
      if (col.default_value && !col.is_identity) {
        const defaultVal = col.default_value.replace(/[\(\)]/g, '');
        if (defaultVal !== 'NULL' && !defaultVal.includes('newid') && !defaultVal.includes('getdate')) {
          definition += ` DEFAULT ${defaultVal}`;
        }
      }
      
      return definition;
    });

    sql += columnDefinitions.join(',\n');

    // Adicionar chave primária
    const primaryKeys = columns.filter(col => col.is_primary_key);
    if (primaryKeys.length > 0) {
      const pkColumns = primaryKeys.map(col => `\`${col.column_name}\``).join(', ');
      sql += `,\n  PRIMARY KEY (${pkColumns})`;
    }

    sql += '\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;';
    
    return sql;
  }

  async extractAllTables() {
    try {
      const sqlPool = await this.db.connectSqlServer();
      
      // Buscar todas as tabelas com informações de tamanho
      const query = `
        SELECT 
          t.name AS table_name,
          p.rows AS row_count,
          CAST(ROUND((SUM(a.used_pages) * 8) / 1024.0, 2) AS NUMERIC(36, 2)) AS used_space_MB
        FROM sys.tables t
        INNER JOIN sys.indexes i ON t.object_id = i.object_id
        INNER JOIN sys.partitions p ON i.object_id = p.object_id AND i.index_id = p.index_id
        INNER JOIN sys.allocation_units a ON p.partition_id = a.container_id
        WHERE t.is_ms_shipped = 0
          AND i.object_id > 255
        GROUP BY t.name, p.rows
        ORDER BY p.rows DESC
      `;

      const result = await sqlPool.request().query(query);
      const tables = result.recordset;

      logger.info(`📋 Encontradas ${tables.length} tabelas para migração`);

      // Criar diretório para schemas
      const schemaDir = path.join(__dirname, '..', 'schemas');
      await fs.mkdir(schemaDir, { recursive: true });

      const allSchemas = {};

      // Extrair schema de cada tabela
      for (const table of tables) {
        logger.info(`📝 Extraindo schema: ${table.table_name} (${table.row_count} registros)`);
        
        const columns = await this.extractTableSchema(table.table_name);
        const createSQL = this.generateCreateTableSQL(table.table_name, columns);
        
        allSchemas[table.table_name] = {
          table_name: table.table_name,
          row_count: table.row_count,
          used_space_mb: table.used_space_MB,
          columns: columns,
          create_sql: createSQL
        };

        // Salvar schema individual
        await fs.writeFile(
          path.join(schemaDir, `${table.table_name}.sql`),
          createSQL
        );
      }

      // Salvar schema completo em JSON
      await fs.writeFile(
        path.join(schemaDir, 'complete-schema.json'),
        JSON.stringify(allSchemas, null, 2)
      );

      // Gerar script SQL completo
      const completeSQL = Object.values(allSchemas)
        .map(table => `-- Tabela: ${table.table_name} (${table.row_count} registros)\n${table.create_sql}`)
        .join('\n\n');

      await fs.writeFile(
        path.join(schemaDir, 'complete-schema.sql'),
        completeSQL
      );

      logger.info(`✅ Schemas extraídos e salvos em: ${schemaDir}`);
      return allSchemas;

    } catch (error) {
      logger.error('❌ Erro ao extrair schemas:', error);
      throw error;
    }
  }
}

module.exports = SchemaExtractor;