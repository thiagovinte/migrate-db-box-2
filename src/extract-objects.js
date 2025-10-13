const DatabaseConnections = require('./database');
const logger = require('./logger');
const fs = require('fs').promises;
const path = require('path');

class DatabaseObjectExtractor {
  constructor() {
    this.db = new DatabaseConnections();
    this.outputDir = path.join(__dirname, '..', 'database-objects');
  }

  async ensureOutputDirectory() {
    try {
      await fs.mkdir(this.outputDir, { recursive: true });
      await fs.mkdir(path.join(this.outputDir, 'views'), { recursive: true });
      await fs.mkdir(path.join(this.outputDir, 'procedures'), { recursive: true });
      await fs.mkdir(path.join(this.outputDir, 'functions'), { recursive: true });
      await fs.mkdir(path.join(this.outputDir, 'triggers'), { recursive: true });
    } catch (error) {
      logger.error('Erro ao criar diretórios:', error);
    }
  }

  // Extrair Views
  async extractViews() {
    logger.info('🔍 Extraindo Views...');
    const sqlPool = await this.db.connectSqlServer();

    try {
      const query = `
        SELECT 
          TABLE_NAME as view_name,
          VIEW_DEFINITION as definition
        FROM INFORMATION_SCHEMA.VIEWS
        WHERE TABLE_SCHEMA = 'dbo'
        ORDER BY TABLE_NAME
      `;

      const result = await sqlPool.request().query(query);
      const views = result.recordset;

      logger.info(`✅ Encontradas ${views.length} views`);

      const viewsData = {
        extracted_at: new Date().toISOString(),
        total_views: views.length,
        views: views.map(view => ({
          name: view.view_name,
          original_sql: view.definition,
          mysql_sql: this.convertViewToMySQL(view.definition),
          notes: this.analyzeViewComplexity(view.definition)
        }))
      };

      await fs.writeFile(
        path.join(this.outputDir, 'views', 'views-export.json'),
        JSON.stringify(viewsData, null, 2)
      );

      // Criar arquivo SQL para MySQL
      let mysqlViewsSQL = '-- Views convertidas para MySQL\n\n';
      viewsData.views.forEach(view => {
        mysqlViewsSQL += `-- View: ${view.name}\n`;
        mysqlViewsSQL += `-- Notas: ${view.notes}\n`;
        mysqlViewsSQL += `CREATE OR REPLACE VIEW \`${view.name}\` AS\n`;
        mysqlViewsSQL += `${view.mysql_sql};\n\n`;
      });

      await fs.writeFile(
        path.join(this.outputDir, 'views', 'views-mysql.sql'),
        mysqlViewsSQL
      );

      return views.length;
    } catch (error) {
      logger.error('Erro ao extrair views:', error);
      throw error;
    }
  }

  // Extrair Stored Procedures
  async extractStoredProcedures() {
    logger.info('🔍 Extraindo Stored Procedures...');
    const sqlPool = await this.db.connectSqlServer();

    try {
      const query = `
        SELECT 
          ROUTINE_NAME as procedure_name,
          ROUTINE_DEFINITION as definition,
          PARAMETER_STYLE,
          DATA_TYPE as return_type
        FROM INFORMATION_SCHEMA.ROUTINES
        WHERE ROUTINE_TYPE = 'PROCEDURE' 
        AND ROUTINE_SCHEMA = 'dbo'
        ORDER BY ROUTINE_NAME
      `;

      const result = await sqlPool.request().query(query);
      const procedures = result.recordset;

      logger.info(`✅ Encontradas ${procedures.length} stored procedures`);

      // Obter parâmetros dos procedures
      for (let proc of procedures) {
        const paramQuery = `
          SELECT 
            PARAMETER_NAME,
            DATA_TYPE,
            PARAMETER_MODE,
            CHARACTER_MAXIMUM_LENGTH
          FROM INFORMATION_SCHEMA.PARAMETERS
          WHERE SPECIFIC_NAME = '${proc.procedure_name}'
          ORDER BY ORDINAL_POSITION
        `;
        
        try {
          const paramResult = await sqlPool.request().query(paramQuery);
          proc.parameters = paramResult.recordset;
        } catch (error) {
          proc.parameters = [];
          logger.warn(`Erro ao obter parâmetros para ${proc.procedure_name}:`, error.message);
        }
      }

      const proceduresData = {
        extracted_at: new Date().toISOString(),
        total_procedures: procedures.length,
        procedures: procedures.map(proc => ({
          name: proc.procedure_name,
          parameters: proc.parameters,
          original_sql: proc.definition,
          mysql_sql: this.convertProcedureToMySQL(proc.definition, proc.parameters),
          complexity: this.analyzeProcedureComplexity(proc.definition),
          migration_notes: this.getProcedureMigrationNotes(proc.definition)
        }))
      };

      await fs.writeFile(
        path.join(this.outputDir, 'procedures', 'procedures-export.json'),
        JSON.stringify(proceduresData, null, 2)
      );

      return procedures.length;
    } catch (error) {
      logger.error('Erro ao extrair stored procedures:', error);
      throw error;
    }
  }

  // Extrair Functions
  async extractFunctions() {
    logger.info('🔍 Extraindo Functions...');
    const sqlPool = await this.db.connectSqlServer();

    try {
      const query = `
        SELECT 
          ROUTINE_NAME as function_name,
          ROUTINE_DEFINITION as definition,
          DATA_TYPE as return_type,
          CHARACTER_MAXIMUM_LENGTH as return_length
        FROM INFORMATION_SCHEMA.ROUTINES
        WHERE ROUTINE_TYPE = 'FUNCTION' 
        AND ROUTINE_SCHEMA = 'dbo'
        ORDER BY ROUTINE_NAME
      `;

      const result = await sqlPool.request().query(query);
      const functions = result.recordset;

      logger.info(`✅ Encontradas ${functions.length} functions`);

      const functionsData = {
        extracted_at: new Date().toISOString(),
        total_functions: functions.length,
        functions: functions.map(func => ({
          name: func.function_name,
          return_type: func.return_type,
          return_length: func.return_length,
          original_sql: func.definition,
          mysql_sql: this.convertFunctionToMySQL(func.definition),
          complexity: this.analyzeFunctionComplexity(func.definition),
          migration_notes: this.getFunctionMigrationNotes(func.definition)
        }))
      };

      await fs.writeFile(
        path.join(this.outputDir, 'functions', 'functions-export.json'),
        JSON.stringify(functionsData, null, 2)
      );

      return functions.length;
    } catch (error) {
      logger.error('Erro ao extrair functions:', error);
      throw error;
    }
  }

  // Conversões T-SQL para MySQL
  convertViewToMySQL(sqlServerSQL) {
    if (!sqlServerSQL) return '';
    
    return sqlServerSQL
      .replace(/\[dbo\]\./g, '') // Remove [dbo].
      .replace(/\[([^\]]+)\]/g, '`$1`') // [table] -> `table`
      .replace(/GETDATE\(\)/g, 'NOW()') // GETDATE() -> NOW()
      .replace(/ISNULL\(/g, 'IFNULL(') // ISNULL -> IFNULL
      .replace(/LEN\(/g, 'LENGTH(') // LEN -> LENGTH
      .replace(/DATEADD\(/g, 'DATE_ADD(') // DATEADD -> DATE_ADD
      .replace(/DATEDIFF\(/g, 'DATEDIFF(') // Já compatível
      .replace(/TOP\s+(\d+)/g, 'LIMIT $1') // TOP n -> LIMIT n
      .trim();
  }

  convertProcedureToMySQL(definition, parameters) {
    if (!definition) return '-- Definição não disponível';
    
    let converted = definition
      .replace(/CREATE\s+PROCEDURE/i, 'DELIMITER $$\nCREATE PROCEDURE')
      .replace(/\[dbo\]\./g, '')
      .replace(/\[([^\]]+)\]/g, '`$1`')
      .replace(/GETDATE\(\)/g, 'NOW()')
      .replace(/@@ROWCOUNT/g, 'ROW_COUNT()')
      .replace(/PRINT\s+/g, '-- PRINT: ')
      .replace(/RAISERROR\s*\(/g, 'SIGNAL SQLSTATE \'45000\' SET MESSAGE_TEXT = ');
    
    converted += '\n$$\nDELIMITER ;';
    return converted;
  }

  convertFunctionToMySQL(definition) {
    if (!definition) return '-- Definição não disponível';
    
    return definition
      .replace(/CREATE\s+FUNCTION/i, 'DELIMITER $$\nCREATE FUNCTION')
      .replace(/\[dbo\]\./g, '')
      .replace(/\[([^\]]+)\]/g, '`$1`')
      .replace(/RETURNS\s+([A-Z]+)/i, 'RETURNS $1')
      .replace(/RETURN\s+/g, 'RETURN ')
      + '\n$$\nDELIMITER ;';
  }

  // Análises de complexidade
  analyzeViewComplexity(definition) {
    if (!definition) return 'Simples';
    
    const complexFeatures = [
      /JOIN/i, /UNION/i, /SUBQUERY/i, /CASE\s+WHEN/i,
      /WINDOW\s+FUNCTION/i, /CTE/i, /PIVOT/i
    ];
    
    const complexCount = complexFeatures.filter(regex => regex.test(definition)).length;
    
    if (complexCount >= 3) return 'Muito Complexa - Requer revisão manual';
    if (complexCount >= 1) return 'Média - Pode precisar ajustes';
    return 'Simples - Conversão automática';
  }

  analyzeProcedureComplexity(definition) {
    if (!definition) return 'Desconhecida';
    
    const complexFeatures = [
      /CURSOR/i, /WHILE/i, /TRY...CATCH/i, /TRANSACTION/i,
      /DYNAMIC\s+SQL/i, /EXEC\s*\(/i, /TEMP\s+TABLE/i
    ];
    
    const complexCount = complexFeatures.filter(regex => regex.test(definition)).length;
    
    if (complexCount >= 3) return 'Alta - Migração manual necessária';
    if (complexCount >= 1) return 'Média - Revisão requerida';
    return 'Baixa - Conversão possível';
  }

  analyzeFunctionComplexity(definition) {
    return this.analyzeProcedureComplexity(definition);
  }

  getProcedureMigrationNotes(definition) {
    const notes = [];
    
    if (/CURSOR/i.test(definition)) notes.push('Contém cursors - considerar substituir por loops');
    if (/TRY...CATCH/i.test(definition)) notes.push('Error handling precisa ser adaptado');
    if (/@@/g.test(definition)) notes.push('Variáveis globais precisam conversão');
    if (/PRINT/i.test(definition)) notes.push('PRINT statements convertidos para comentários');
    
    return notes.length ? notes : ['Conversão direta possível'];
  }

  getFunctionMigrationNotes(definition) {
    return this.getProcedureMigrationNotes(definition);
  }

  // Método principal
  async extractAllObjects() {
    await this.ensureOutputDirectory();
    
    logger.info('🚀 Iniciando extração de objetos do banco de dados...');
    
    try {
      const viewCount = await this.extractViews();
      const procCount = await this.extractStoredProcedures();
      const funcCount = await this.extractFunctions();
      
      const summary = {
        extraction_date: new Date().toISOString(),
        summary: {
          views: viewCount,
          stored_procedures: procCount,
          functions: funcCount,
          total_objects: viewCount + procCount + funcCount
        }
      };
      
      await fs.writeFile(
        path.join(this.outputDir, 'extraction-summary.json'),
        JSON.stringify(summary, null, 2)
      );
      
      logger.info('🎉 Extração concluída!');
      logger.info(`📊 Total de objetos: ${summary.summary.total_objects}`);
      logger.info(`📁 Arquivos salvos em: ${this.outputDir}`);
      
      return summary;
    } catch (error) {
      logger.error('💥 Erro durante extração:', error);
      throw error;
    } finally {
      await this.db.closeAll();
    }
  }
}

// Execução via linha de comando
async function main() {
  const extractor = new DatabaseObjectExtractor();
  
  try {
    await extractor.extractAllObjects();
  } catch (error) {
    logger.error('Erro na extração:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = DatabaseObjectExtractor;