const pool = require('./src/db');

async function check() {
  try {
    const res = await pool.query('SELECT * FROM user_profiles LIMIT 5');
    console.log('User Profiles in Database:');
    console.log(JSON.stringify(res.rows, null, 2));
    
    const users = await pool.query('SELECT id, email, full_name, phone FROM users LIMIT 5');
    console.log('Users in Database:');
    console.log(JSON.stringify(users.rows, null, 2));
  } catch (err) {
    console.error('Error querying database:', err.message);
  } finally {
    await pool.end();
  }
}

check();
