// Run: node scripts/list-users.mjs
const SUPABASE_URL = 'https://ooiqyptgaakasfczmiyp.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SERVICE_KEY) {
  console.error('Set SUPABASE_SERVICE_KEY env var');
  process.exit(1);
}

let page = 1;
const all = [];

while (true) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?page=${page}&per_page=1000`, {
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
    },
  });
  const data = await res.json();
  const users = data.users ?? [];
  if (!users.length) break;
  all.push(...users);
  if (users.length < 1000) break;
  page++;
}

console.log(`\nTotal users: ${all.length}\n`);
all
  .filter(u => u.email)
  .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
  .forEach(u => console.log(`${u.email}  (joined ${u.created_at.slice(0, 10)})`));
