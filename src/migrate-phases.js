const DataMigrator = require("./data-migrator");
const logger = require("./logger");
const verifyMigration = require("./verify");

class PhasedMigration {
  constructor() {
    this.migrator = new DataMigrator();
    this.phases = {
      1: {
        name: "Tabelas de Referência",
        description: "DOM_* e tabelas pequenas de configuração",
        tables: ["DOM_Uf", "DOM_Municipios", "DOM_StatusEncomendas", "DOM_TagsEncomenda", "DOM_TiposPagamentos", "DOM_StatusRegistrosFinaceiros", "DOM_DePara_Status_Registros_Financeiros_Galax"],
        risk: "BAIXO",
        estimated_time: "2-5 min",
      },
      2: {
        name: "Configurações e Cadastros",
        description: "Empresas, perfis, categorias básicas",
        tables: [
          "Empresas",
          "Empresas_Bling",
          "Perfis",
          "Categorias",
          "TiposCaixa",
          "MarcasPersonalidades",
          "CarteirasCobranca",
          "CarteirasCobranca_FormasPagamento",
          "CarteirasCobranca_Recebedores",
          "Banners",
          "Textos",
          "Faq",
          "tabelasFrete",
          "Cupoms",
          "integrationConfig",
        ],
        risk: "BAIXO",
        estimated_time: "2-3 min",
      },
      3: {
        name: "Produtos e Caixas",
        description: "Sistema de produtos e caixas de sorteio",
        tables: [
          "Produtos",
          "Produtos_Categorias",
          "Produtos_Bling_vinculo",
          "Produtos_Shopping",
          "Produtos_Estoque_Historico", // 389k registros - GRANDE!
          "Caixas",
          "CaixasItens",
        ],
        risk: "MÉDIO",
        estimated_time: "15-20 min",
      },
      4: {
        name: "Usuários e Conta Digital",
        description: "Base de usuários e contas digitais",
        tables: [
          "Usuarios", // 104k registros
          "Usuarios_Bling_vinculo",
          "UsuariosCartoes",
          "UsuariosContaDigital", // 104k registros
          "UsuariosFreteGratis",
        ],
        risk: "MÉDIO-ALTO",
        estimated_time: "10-15 min",
      },
      5: {
        name: "Encomendas e Relacionamentos",
        description: "Sistema de encomendas e relacionamentos",
        tables: [
          "UsuariosEncomendas",
          "UsuariosEncomendasItens",
          "UsuariosEncomendasTags",
          "UsuariosEncomendasRelacionamento",
          "Encomendas_Bling_vinculo",
          "Carrinhos",
          "Carrinho_Itens",
          "UsuariosCompras",
        ],
        risk: "MÉDIO",
        estimated_time: "8-12 min",
      },
      6: {
        name: "Registros Financeiros",
        description: "Sistema financeiro (sem transações grandes)",
        tables: [
          "Registros_Financeiros", // 86k registros
          "Registros_Financeiros_Acoes",
          "Registros_Financeiros_Status_Historico", // 174k registros
          "Registros_Financeiros_Webhooks", // 83k registros
          "Saques",
        ],
        risk: "ALTO",
        estimated_time: "20-30 min",
      },
      7: {
        name: "Transações Grandes - CUIDADO!",
        description: "Tabelas com maior volume de dados",
        tables: [
          "UsuariosContaDigitalTransacoes", // 757k registros - GIGANTE!
          "CaixasSorteios", // 362k registros
        ],
        risk: "MUITO ALTO",
        estimated_time: "60-90 min",
      },
    };
  }

  showPhases() {
    logger.info("📋 FASES DE MIGRAÇÃO DISPONÍVEIS:");
    logger.info("================================");

    for (const [phaseNum, phase] of Object.entries(this.phases)) {
      const riskColor = {
        BAIXO: "🟢",
        MÉDIO: "🟡",
        "MÉDIO-ALTO": "🟠",
        ALTO: "🔴",
        "MUITO ALTO": "🔴🔴",
      };

      logger.info(`\n${riskColor[phase.risk]} FASE ${phaseNum}: ${phase.name}`);
      logger.info(`   Descrição: ${phase.description}`);
      logger.info(`   Risco: ${phase.risk} | Tempo estimado: ${phase.estimated_time}`);
      logger.info(`   Tabelas (${phase.tables.length}): ${phase.tables.join(", ")}`);
    }

    logger.info("\n💡 RECOMENDAÇÕES:");
    logger.info("• Executar fases 1-2 sempre (baixo risco)");
    logger.info("• Fases 3-6: executar fora do horário comercial");
    logger.info("• Fase 7: fazer backup antes, executar de madrugada");
    logger.info("• Sempre verificar cada fase antes de prosseguir");
  }

  async executePhase(phaseNumber) {
    const phase = this.phases[phaseNumber];
    if (!phase) {
      logger.error(`❌ Fase ${phaseNumber} não existe!`);
      return false;
    }

    logger.info(`\n🚀 INICIANDO FASE ${phaseNumber}: ${phase.name}`);
    logger.info(`📊 Risco: ${phase.risk} | Tempo estimado: ${phase.estimated_time}`);
    logger.info(`📝 Tabelas: ${phase.tables.join(", ")}`);
    logger.info("=====================================");

    try {
      const startTime = new Date();

      // Migrar tabelas da fase
      await this.migrator.migrateTables(phase.tables);

      const endTime = new Date();
      const duration = Math.round((endTime - startTime) / 1000);

      logger.info(`\n✅ FASE ${phaseNumber} CONCLUÍDA!`);
      logger.info(`⏱️  Tempo real: ${Math.floor(duration / 60)}min ${duration % 60}s`);

      // Verificar algumas tabelas da fase
      logger.info(`\n🔍 Verificando migração...`);
      await this.verifyPhase(phase.tables.slice(0, 3)); // Verificar primeiras 3 tabelas

      return true;
    } catch (error) {
      logger.error(`❌ ERRO na Fase ${phaseNumber}:`, error.message);
      return false;
    }
  }

  async verifyPhase(tables) {
    for (const table of tables) {
      try {
        await verifyMigration(table);
      } catch (error) {
        logger.error(`❌ Erro na verificação de ${table}:`, error.message);
      }
    }
  }

  async executeSequential(startPhase = 1, endPhase = 7) {
    logger.info(`🚀 EXECUÇÃO SEQUENCIAL: Fases ${startPhase} a ${endPhase}`);

    let success = true;

    for (let phase = startPhase; phase <= endPhase; phase++) {
      if (!this.phases[phase]) continue;

      logger.info(`\n⏸️  Preparando Fase ${phase}...`);

      // Para fases de risco alto, pedir confirmação
      if (this.phases[phase].risk === "ALTO" || this.phases[phase].risk === "MUITO ALTO") {
        logger.info(`⚠️  ATENÇÃO: Fase ${phase} tem risco ${this.phases[phase].risk}`);
        logger.info(`⏸️  Execute manualmente quando estiver pronto:`);
        logger.info(`   node src/migrate-phases.js ${phase}`);
        break;
      }

      const phaseSuccess = await this.executePhase(phase);
      if (!phaseSuccess) {
        logger.error(`💥 Falha na Fase ${phase}. Parando execução.`);
        success = false;
        break;
      }

      // Pausa entre fases
      if (phase < endPhase) {
        logger.info(`⏸️  Pausa de 5 segundos antes da próxima fase...`);
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    }

    if (success) {
      logger.info(`\n🎉 EXECUÇÃO SEQUENCIAL CONCLUÍDA COM SUCESSO!`);
    }

    return success;
  }

  async executeSafe() {
    logger.info("🛡️  EXECUÇÃO SEGURA: Apenas fases de baixo risco (1-2)");
    return await this.executeSequential(1, 2);
  }
}

// Execução via linha de comando
async function main() {
  const migration = new PhasedMigration();
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    migration.showPhases();
    console.log(`\n📖 COMO USAR:`);
    console.log(`node src/migrate-phases.js <fase>     - Executar fase específica`);
    console.log(`node src/migrate-phases.js safe       - Executar fases 1-2 (seguro)`);
    console.log(`node src/migrate-phases.js all        - Executar fases 1-6 (parar antes da 7)`);
    console.log(`node src/migrate-phases.js list       - Mostrar fases disponíveis`);
    return;
  }

  const command = args[0].toLowerCase();

  try {
    switch (command) {
      case "list":
        migration.showPhases();
        break;

      case "safe":
        await migration.executeSafe();
        break;

      case "all":
        await migration.executeSequential(1, 6);
        break;

      default:
        const phase = parseInt(command);
        if (phase >= 1 && phase <= 7) {
          await migration.executePhase(phase);
        } else {
          logger.error(`❌ Fase inválida: ${command}`);
          migration.showPhases();
        }
    }
  } catch (error) {
    logger.error("💥 Erro durante execução:", error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = PhasedMigration;
