require('dotenv').config();

const sqlServerConfig = {
  server: process.env.SQLSERVER_HOST,
  port: parseInt(process.env.SQLSERVER_PORT),
  database: process.env.SQLSERVER_DATABASE,
  user: process.env.SQLSERVER_USERNAME,
  password: process.env.SQLSERVER_PASSWORD,
  options: {
    encrypt: process.env.SQLSERVER_ENCRYPT === 'true',
    trustServerCertificate: process.env.SQLSERVER_TRUST_SERVER_CERTIFICATE === 'true',
    instancename: process.env.SQLSERVER_INSTANCE
  },
  connectionTimeout: parseInt(process.env.SQLSERVER_CONNECTION_TIMEOUT) || 30000,
  requestTimeout: parseInt(process.env.SQLSERVER_REQUEST_TIMEOUT) || 30000
};

const mysqlConfig = {
  host: process.env.MYSQL_HOST,
  port: parseInt(process.env.MYSQL_PORT),
  database: process.env.MYSQL_DATABASE,
  user: process.env.MYSQL_USERNAME,
  password: process.env.MYSQL_PASSWORD,
  ssl: process.env.MYSQL_ENCRYPT === 'true' ? { rejectUnauthorized: false } : false,
  connectTimeout: parseInt(process.env.MYSQL_CONNECTION_TIMEOUT) || 30000,
  acquireTimeout: parseInt(process.env.MYSQL_REQUEST_TIMEOUT) || 30000
};

module.exports = {
  sqlServerConfig,
  mysqlConfig
};