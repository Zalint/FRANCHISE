module.exports = {
    up: async (queryInterface, Sequelize) => {
        await queryInterface.addColumn('performance_achat', 'prix', {
            type: Sequelize.FLOAT,
            allowNull: true,
            comment: 'Prix total d\'achat en FCFA'
        });
    },
    
    down: async (queryInterface, Sequelize) => {
        await queryInterface.removeColumn('performance_achat', 'prix');
    }
};

