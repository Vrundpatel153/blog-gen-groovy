import pg from 'pg';

const connectionString = 'postgresql://postgres:Vrund@1532005@db.tyklzemoaobwzirhwqpl.supabase.co:5432/postgres';

async function main() {
  const client = new pg.Client({ connectionString });
  await client.connect();

  console.log('Fetching functions from public schema...');
  const res = await client.query(`
    SELECT routine_name, routine_type
    FROM information_schema.routines
    WHERE routine_schema = 'public'
    ORDER BY routine_name;
  `);
  console.log('Functions:', res.rows);

  console.log('\nFetching table schemas...');
  const tables = await client.query(`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public'
    ORDER BY table_name;
  `);
  console.log('Tables:', tables.rows);

  await client.end();
}

main().catch(console.error);
