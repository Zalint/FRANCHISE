const bcrypt = require('bcrypt');
const fs = require('fs');
const path = require('path');

const NEW_PASSWORD = 'Mata2024@!';
const USERS_JSON_PATH = path.join(__dirname, '..', 'users.json');

(async () => {
    const users = JSON.parse(fs.readFileSync(USERS_JSON_PATH, 'utf8'));
    const hash = await bcrypt.hash(NEW_PASSWORD, 10);
    users.forEach(u => { u.password = hash; });
    fs.writeFileSync(USERS_JSON_PATH, JSON.stringify(users, null, 2) + '\n');
    console.log(`Reset ${users.length} users in users.json to "${NEW_PASSWORD}"`);
})().catch(err => { console.error(err); process.exit(1); });
