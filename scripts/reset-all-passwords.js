require('dotenv').config({
    path: process.env.NODE_ENV === 'production' ? '.env' : '.env.local'
});
const bcrypt = require('bcrypt');
const { User } = require('../db/models');

const NEW_PASSWORD = 'Mata2024@!';

async function resetAllPasswords() {
    try {
        console.log('🔐 Réinitialisation des mots de passe...');
        console.log(`   Nouveau mot de passe: ${NEW_PASSWORD}`);
        console.log('');

        const hashedPassword = await bcrypt.hash(NEW_PASSWORD, 10);

        const users = await User.findAll({ attributes: ['id', 'username', 'active'] });

        if (users.length === 0) {
            console.log('❌ Aucun utilisateur trouvé en base de données.');
            process.exit(1);
        }

        console.log(`📋 ${users.length} utilisateur(s) trouvé(s):`);
        users.forEach(u => console.log(`   - ${u.username} (${u.active ? 'actif' : 'inactif'})`));
        console.log('');

        await User.update({ password: hashedPassword }, { where: {} });

        console.log(`✅ Mot de passe mis à jour pour ${users.length} utilisateur(s).`);
        process.exit(0);
    } catch (error) {
        console.error('❌ Erreur:', error.message);
        process.exit(1);
    }
}

resetAllPasswords();
