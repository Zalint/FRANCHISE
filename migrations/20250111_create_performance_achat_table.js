module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('performance_achat', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true
      },
      date: {
        type: Sequelize.DATEONLY,
        allowNull: false,
        comment: 'Date de l\'achat/estimation au format YYYY-MM-DD'
      },
      id_acheteur: {
        type: Sequelize.STRING(50),
        allowNull: false,
        comment: 'Référence à acheteur.json (identifiant unique)'
      },
      bete: {
        type: Sequelize.STRING(20),
        allowNull: false,
        comment: 'Type: boeuf ou veau'
      },
      
      // === ESTIMATION ===
      poids_estime: {
        type: Sequelize.FLOAT,
        allowNull: true,
        comment: 'Poids estimé en kg par l\'acheteur'
      },
      poids_estime_timestamp: {
        type: Sequelize.DATE,
        allowNull: true,
        comment: 'Date et heure de dernière modification du poids estimé'
      },
      poids_estime_updated_by: {
        type: Sequelize.STRING(100),
        allowNull: true,
        comment: 'Utilisateur ayant modifié le poids estimé'
      },
      
      // === RÉALITÉ ===
      poids_reel: {
        type: Sequelize.FLOAT,
        allowNull: true,
        comment: 'Poids réel en kg après abattage'
      },
      poids_reel_timestamp: {
        type: Sequelize.DATE,
        allowNull: true,
        comment: 'Date et heure de dernière modification du poids réel'
      },
      poids_reel_updated_by: {
        type: Sequelize.STRING(100),
        allowNull: true,
        comment: 'Utilisateur ayant modifié le poids réel'
      },
      
      // === MÉTADONNÉES ===
      locked: {
        type: Sequelize.BOOLEAN,
        defaultValue: false,
        comment: 'Verrouillé pour empêcher modifications (nécessite déverrouillage Admin)'
      },
      commentaire: {
        type: Sequelize.TEXT,
        allowNull: true,
        comment: 'Commentaires ou notes sur cette entrée'
      },
      created_by: {
        type: Sequelize.STRING(100),
        allowNull: true,
        comment: 'Utilisateur ayant créé l\'entrée'
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      }
    });

    // Créer les index pour améliorer les performances
    await queryInterface.addIndex('performance_achat', ['date', 'bete'], {
      name: 'idx_performance_achat_date_bete'
    });
    
    await queryInterface.addIndex('performance_achat', ['id_acheteur'], {
      name: 'idx_performance_achat_acheteur'
    });
    
    await queryInterface.addIndex('performance_achat', ['date'], {
      name: 'idx_performance_achat_date'
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('performance_achat');
  }
};

