import postgres from 'postgres';
import dotenv from 'dotenv';
dotenv.config();
const sql = postgres(process.env.DATABASE_URL!, { ssl: 'require' });
async function run() {
    const res = await sql`SELECT count(*) FROM msajce_entities`;
    console.log(`\n\n🎯 FINAL TOTAL ENTITIES: ${res[0].count}\n\n`);
    await sql.end();
}
run();
