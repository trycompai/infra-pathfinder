const { Pool } = require('pg');

async function testConnection() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });
  
  try {
    const client = await pool.connect();
    console.log('✅ Database connection successful');
    
    const result = await client.query('SELECT * FROM todos LIMIT 1');
    console.log('✅ Query successful:', result.rowCount, 'rows');
    
    client.release();
    await pool.end();
  } catch (error) {
    console.error('❌ Database error:', error.message);
    console.error('Connection string:', process.env.DATABASE_URL);
    process.exit(1);
  }
}

testConnection();
