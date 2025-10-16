const sql = require('mssql');
const { sqlServerConfig } = require('./config');
const logger = require('./logger');

async function updateUserPasswords() {
    let pool;
    
    try {
        logger.info('Conectando ao SQL Server...');
        pool = await sql.connect(sqlServerConfig);
        logger.info('Conexão com SQL Server estabelecida com sucesso!');
        
        const newPassword = 'eXhtaHhGaXdXOVFfJDl0';
        
        // Primeiro, consulta quantos usuários serão afetados
        const countResult = await pool.request()
            .query('SELECT COUNT(*) as total FROM usuarios WHERE idPerfil = 1');
        
        const totalUsers = countResult.recordset[0].total;
        logger.info(`Encontrados ${totalUsers} usuários com idPerfil = 1`);
        
        if (totalUsers === 0) {
            logger.warn('Nenhum usuário encontrado com idPerfil = 1');
            return;
        }
        
        // Lista os usuários que serão alterados
        const selectResult = await pool.request()
            .query(`
                SELECT id, nome, email 
                FROM usuarios 
                WHERE idPerfil = 1
            `);
        
        logger.info('Usuários que terão as senhas alteradas:');
        selectResult.recordset.forEach(user => {
            logger.info(`- ID: ${user.id}, Nome: ${user.nome}, Email: ${user.email}`);
        });
        
        // Atualiza as senhas
        const updateResult = await pool.request()
            .input('newPassword', sql.VarChar, newPassword)
            .query(`
                UPDATE usuarios 
                SET senha = @newPassword 
                WHERE idPerfil = 1
            `);
        
        logger.info(`✓ Senhas atualizadas com sucesso! ${updateResult.rowsAffected[0]} usuários afetados.`);
        
    } catch (error) {
        logger.error('Erro ao atualizar senhas:', error);
        throw error;
    } finally {
        if (pool) {
            await pool.close();
            logger.info('Conexão fechada.');
        }
    }
}

if (require.main === module) {
    updateUserPasswords()
        .then(() => {
            logger.info('Processo concluído com sucesso!');
            process.exit(0);
        })
        .catch(error => {
            logger.error('Processo falhou:', error);
            process.exit(1);
        });
}

module.exports = { updateUserPasswords };