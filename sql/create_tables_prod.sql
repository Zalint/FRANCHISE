-- =====================================================
-- SQL Script pour créer la base de données PRODUCTION
-- Application: Gestion des Ventes - KEUR BALI
-- Base de données: ventes_kb_prod
-- Date: Généré automatiquement
-- =====================================================

-- Supprimer les tables existantes si nécessaire (ATTENTION: décommenter seulement si nécessaire)
-- DROP TABLE IF EXISTS paiements_abonnement CASCADE;
-- DROP TABLE IF EXISTS clients_abonnes CASCADE;
-- DROP TABLE IF EXISTS payment_links CASCADE;
-- DROP TABLE IF EXISTS audit_client_logs CASCADE;
-- DROP TABLE IF EXISTS performance_achat CASCADE;
-- DROP TABLE IF EXISTS precommandes CASCADE;
-- DROP TABLE IF EXISTS estimations CASCADE;
-- DROP TABLE IF EXISTS weight_params CASCADE;
-- DROP TABLE IF EXISTS achats_boeuf CASCADE;
-- DROP TABLE IF EXISTS cash_payments CASCADE;
-- DROP TABLE IF EXISTS reconciliations CASCADE;
-- DROP TABLE IF EXISTS transferts CASCADE;
-- DROP TABLE IF EXISTS stocks CASCADE;
-- DROP TABLE IF EXISTS ventes CASCADE;

-- =====================================================
-- CRÉATION DES TYPES ENUM
-- =====================================================

-- Type pour le statut des clients abonnés
DO $$ BEGIN
    CREATE TYPE statut_client AS ENUM ('actif', 'inactif');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Type pour le statut des pré-commandes
DO $$ BEGIN
    CREATE TYPE statut_precommande AS ENUM ('ouvert', 'convertie', 'annulee', 'archivee');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- =====================================================
-- TABLE: ventes
-- Description: Enregistre toutes les transactions de vente
-- =====================================================
CREATE TABLE IF NOT EXISTS ventes (
    id SERIAL PRIMARY KEY,
    mois VARCHAR(255) NOT NULL,
    date VARCHAR(255) NOT NULL,
    semaine VARCHAR(255),
    point_vente VARCHAR(255) NOT NULL,
    preparation VARCHAR(255),
    categorie VARCHAR(255) NOT NULL,
    produit VARCHAR(255) NOT NULL,
    prix_unit FLOAT NOT NULL,
    nombre FLOAT NOT NULL DEFAULT 0,
    montant FLOAT NOT NULL DEFAULT 0,
    nom_client VARCHAR(255),
    numero_client VARCHAR(255),
    adresse_client VARCHAR(255),
    creance BOOLEAN NOT NULL DEFAULT FALSE,
    client_abonne_id INTEGER,
    prix_normal DECIMAL(10, 2),
    rabais_applique DECIMAL(10, 2),
    extension JSONB,
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Index pour améliorer les performances de recherche
CREATE INDEX IF NOT EXISTS idx_ventes_date ON ventes(date);
CREATE INDEX IF NOT EXISTS idx_ventes_point_vente ON ventes(point_vente);
CREATE INDEX IF NOT EXISTS idx_ventes_mois ON ventes(mois);
CREATE INDEX IF NOT EXISTS idx_ventes_client_abonne_id ON ventes(client_abonne_id);

-- =====================================================
-- TABLE: stocks
-- Description: Stocke les informations d'inventaire (matin et soir)
-- =====================================================
CREATE TABLE IF NOT EXISTS stocks (
    id SERIAL PRIMARY KEY,
    date VARCHAR(255) NOT NULL,
    type_stock VARCHAR(255) NOT NULL,
    point_vente VARCHAR(255) NOT NULL,
    produit VARCHAR(255) NOT NULL,
    quantite FLOAT NOT NULL DEFAULT 0,
    prix_unitaire FLOAT NOT NULL DEFAULT 0,
    total FLOAT NOT NULL DEFAULT 0,
    commentaire TEXT,
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Index pour améliorer les performances de recherche
CREATE INDEX IF NOT EXISTS idx_stocks_date ON stocks(date);
CREATE INDEX IF NOT EXISTS idx_stocks_point_vente ON stocks(point_vente);
CREATE INDEX IF NOT EXISTS idx_stocks_type_stock ON stocks(type_stock);

-- =====================================================
-- TABLE: transferts
-- Description: Gère les mouvements de stock entre points de vente
-- =====================================================
CREATE TABLE IF NOT EXISTS transferts (
    id SERIAL PRIMARY KEY,
    date VARCHAR(255) NOT NULL,
    point_vente VARCHAR(255) NOT NULL,
    produit VARCHAR(255) NOT NULL,
    quantite FLOAT NOT NULL DEFAULT 0,
    prix_unitaire FLOAT NOT NULL DEFAULT 0,
    total FLOAT NOT NULL DEFAULT 0,
    impact VARCHAR(255) NOT NULL,
    commentaire TEXT,
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Index pour améliorer les performances de recherche
CREATE INDEX IF NOT EXISTS idx_transferts_date ON transferts(date);
CREATE INDEX IF NOT EXISTS idx_transferts_point_vente ON transferts(point_vente);

-- =====================================================
-- TABLE: reconciliations
-- Description: Stocke les données de réconciliation journalière
-- =====================================================
CREATE TABLE IF NOT EXISTS reconciliations (
    id SERIAL PRIMARY KEY,
    date VARCHAR(255) NOT NULL UNIQUE,
    data TEXT NOT NULL,
    "cashPaymentData" TEXT,
    comments TEXT,
    calculated BOOLEAN DEFAULT TRUE,
    version INTEGER DEFAULT 1,
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Index unique sur la date
CREATE UNIQUE INDEX IF NOT EXISTS idx_reconciliations_date ON reconciliations(date);

-- =====================================================
-- TABLE: cash_payments
-- Description: Stocke les paiements en espèces et mobile money
-- =====================================================
CREATE TABLE IF NOT EXISTS cash_payments (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    amount FLOAT NOT NULL,
    merchant_fee FLOAT,
    customer_fee FLOAT,
    customer_name VARCHAR(255),
    customer_phone VARCHAR(255),
    entete_trans_type VARCHAR(255),
    psp_name VARCHAR(255),
    payment_category VARCHAR(255),
    payment_means VARCHAR(255),
    payment_reference VARCHAR(255),
    merchant_reference VARCHAR(255),
    trn_status VARCHAR(255),
    tr_id VARCHAR(255),
    cust_country VARCHAR(255),
    aggregation_mt VARCHAR(255),
    total_nom_marchand VARCHAR(255),
    total_marchand VARCHAR(255),
    merchant_id VARCHAR(255),
    name_first VARCHAR(255),
    point_de_vente VARCHAR(255),
    date DATE,
    reference VARCHAR(255),
    comment TEXT,
    is_manual BOOLEAN DEFAULT FALSE,
    created_by VARCHAR(255),
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Index pour améliorer les performances de recherche
CREATE INDEX IF NOT EXISTS idx_cash_payments_date ON cash_payments(date);
CREATE INDEX IF NOT EXISTS idx_cash_payments_point_de_vente ON cash_payments(point_de_vente);

-- =====================================================
-- TABLE: achats_boeuf
-- Description: Suivi des achats de bœuf
-- =====================================================
CREATE TABLE IF NOT EXISTS achats_boeuf (
    id SERIAL PRIMARY KEY,
    mois VARCHAR(255),
    date DATE NOT NULL,
    bete VARCHAR(255),
    prix FLOAT,
    abats FLOAT DEFAULT 0,
    frais_abattage FLOAT DEFAULT 0,
    nbr_kg FLOAT,
    prix_achat_kg FLOAT,
    prix_achat_kg_sans_abats FLOAT,
    commentaire TEXT,
    annee INTEGER,
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Index pour améliorer les performances de recherche
CREATE INDEX IF NOT EXISTS idx_achats_boeuf_date ON achats_boeuf(date);
CREATE INDEX IF NOT EXISTS idx_achats_boeuf_mois ON achats_boeuf(mois);

-- =====================================================
-- TABLE: weight_params
-- Description: Paramètres de poids par animal pour la réconciliation
-- =====================================================
CREATE TABLE IF NOT EXISTS weight_params (
    id SERIAL PRIMARY KEY,
    date VARCHAR(255) NOT NULL UNIQUE,
    boeuf_kg_per_unit FLOAT NOT NULL DEFAULT 150,
    veau_kg_per_unit FLOAT NOT NULL DEFAULT 110,
    agneau_kg_per_unit FLOAT NOT NULL DEFAULT 10,
    poulet_kg_per_unit FLOAT NOT NULL DEFAULT 1.5,
    default_kg_per_unit FLOAT NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Index unique sur la date
CREATE UNIQUE INDEX IF NOT EXISTS idx_weight_params_date ON weight_params(date);

-- =====================================================
-- TABLE: precommandes
-- Description: Gestion des pré-commandes clients
-- =====================================================
CREATE TABLE IF NOT EXISTS precommandes (
    id SERIAL PRIMARY KEY,
    mois VARCHAR(255) NOT NULL,
    date_enregistrement VARCHAR(255) NOT NULL,
    date_reception VARCHAR(255) NOT NULL,
    semaine VARCHAR(255),
    point_vente VARCHAR(255) NOT NULL,
    preparation VARCHAR(255),
    categorie VARCHAR(255) NOT NULL,
    produit VARCHAR(255) NOT NULL,
    prix_unit FLOAT NOT NULL,
    nombre FLOAT NOT NULL DEFAULT 0,
    montant FLOAT NOT NULL DEFAULT 0,
    nom_client VARCHAR(255),
    numero_client VARCHAR(255),
    adresse_client VARCHAR(255),
    commentaire TEXT,
    label VARCHAR(255),
    statut VARCHAR(20) NOT NULL DEFAULT 'ouvert' CHECK (statut IN ('ouvert', 'convertie', 'annulee', 'archivee')),
    commentaire_statut TEXT,
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Index pour améliorer les performances de recherche
CREATE INDEX IF NOT EXISTS idx_precommandes_date_reception ON precommandes(date_reception);
CREATE INDEX IF NOT EXISTS idx_precommandes_point_vente ON precommandes(point_vente);
CREATE INDEX IF NOT EXISTS idx_precommandes_statut ON precommandes(statut);

-- =====================================================
-- TABLE: estimations
-- Description: Estimations de ventes et stocks
-- =====================================================
CREATE TABLE IF NOT EXISTS estimations (
    id SERIAL PRIMARY KEY,
    date VARCHAR(255) NOT NULL,
    point_vente VARCHAR(255) NOT NULL,
    categorie VARCHAR(255),
    produit VARCHAR(255),
    stock_matin FLOAT DEFAULT 0,
    stock_matin_original FLOAT DEFAULT 0,
    transfert FLOAT DEFAULT 0,
    transfert_original FLOAT DEFAULT 0,
    stock_soir FLOAT DEFAULT 0,
    stock_soir_original FLOAT DEFAULT 0,
    pre_commande_demain FLOAT DEFAULT 0,
    prevision_ventes FLOAT DEFAULT 0,
    difference FLOAT DEFAULT 0,
    stock_modified BOOLEAN DEFAULT FALSE,
    ventes_theoriques FLOAT,
    commentaire TEXT,
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Index pour améliorer les performances de recherche
CREATE INDEX IF NOT EXISTS idx_estimations_date ON estimations(date);
CREATE INDEX IF NOT EXISTS idx_estimations_point_vente ON estimations(point_vente);

-- =====================================================
-- TABLE: clients_abonnes
-- Description: Clients avec abonnement
-- =====================================================
CREATE TABLE IF NOT EXISTS clients_abonnes (
    id SERIAL PRIMARY KEY,
    abonne_id VARCHAR(20) NOT NULL UNIQUE,
    prenom VARCHAR(100) NOT NULL,
    nom VARCHAR(100) NOT NULL,
    telephone VARCHAR(20) NOT NULL UNIQUE,
    adresse TEXT,
    position_gps VARCHAR(255),
    lien_google_maps TEXT,
    point_vente_defaut VARCHAR(50) NOT NULL,
    statut VARCHAR(20) NOT NULL DEFAULT 'actif' CHECK (statut IN ('actif', 'inactif')),
    date_inscription DATE NOT NULL DEFAULT CURRENT_DATE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Index pour améliorer les performances de recherche
CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_abonnes_abonne_id ON clients_abonnes(abonne_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_abonnes_telephone ON clients_abonnes(telephone);
CREATE INDEX IF NOT EXISTS idx_clients_abonnes_point_vente ON clients_abonnes(point_vente_defaut);
CREATE INDEX IF NOT EXISTS idx_clients_abonnes_statut ON clients_abonnes(statut);
CREATE INDEX IF NOT EXISTS idx_clients_abonnes_date_inscription ON clients_abonnes(date_inscription);

-- =====================================================
-- TABLE: paiements_abonnement
-- Description: Paiements des abonnements clients
-- =====================================================
CREATE TABLE IF NOT EXISTS paiements_abonnement (
    id SERIAL PRIMARY KEY,
    client_id INTEGER NOT NULL REFERENCES clients_abonnes(id) ON DELETE CASCADE ON UPDATE CASCADE,
    mois VARCHAR(7) NOT NULL,
    montant DECIMAL(10, 2) NOT NULL DEFAULT 5000 CHECK (montant >= 0),
    date_paiement DATE NOT NULL,
    mode_paiement VARCHAR(50),
    payment_link_id VARCHAR(255),
    reference VARCHAR(255),
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_client_mois UNIQUE (client_id, mois)
);

-- Index pour améliorer les performances de recherche
CREATE INDEX IF NOT EXISTS idx_paiements_abonnement_client_id ON paiements_abonnement(client_id);
CREATE INDEX IF NOT EXISTS idx_paiements_abonnement_mois ON paiements_abonnement(mois);
CREATE INDEX IF NOT EXISTS idx_paiements_abonnement_date_paiement ON paiements_abonnement(date_paiement);

-- =====================================================
-- TABLE: payment_links
-- Description: Liens de paiement générés
-- =====================================================
CREATE TABLE IF NOT EXISTS payment_links (
    id SERIAL PRIMARY KEY,
    payment_link_id VARCHAR(255) NOT NULL UNIQUE,
    point_vente VARCHAR(255) NOT NULL,
    client_name VARCHAR(255),
    phone_number VARCHAR(50),
    address TEXT,
    amount DECIMAL(12, 2) NOT NULL CHECK (amount >= 0.01),
    currency VARCHAR(10) NOT NULL DEFAULT 'XOF',
    reference VARCHAR(255) NOT NULL,
    description TEXT,
    payment_url TEXT NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'opened',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_by VARCHAR(255),
    due_date TIMESTAMP WITH TIME ZONE,
    archived INTEGER NOT NULL DEFAULT 0,
    is_abonnement BOOLEAN NOT NULL DEFAULT FALSE,
    client_abonne_id INTEGER
);

-- Index pour améliorer les performances de recherche
CREATE INDEX IF NOT EXISTS idx_payment_links_payment_link_id ON payment_links(payment_link_id);
CREATE INDEX IF NOT EXISTS idx_payment_links_archived ON payment_links(archived);
CREATE INDEX IF NOT EXISTS idx_payment_links_point_vente ON payment_links(point_vente);
CREATE INDEX IF NOT EXISTS idx_payment_links_created_at ON payment_links(created_at);

-- =====================================================
-- TABLE: performance_achat
-- Description: Performance des acheteurs (estimation vs réalité)
-- =====================================================
CREATE TABLE IF NOT EXISTS performance_achat (
    id SERIAL PRIMARY KEY,
    date DATE NOT NULL,
    id_acheteur VARCHAR(50) NOT NULL,
    bete VARCHAR(20) NOT NULL,
    poids_estime FLOAT,
    poids_estime_timestamp TIMESTAMP WITH TIME ZONE,
    poids_estime_updated_by VARCHAR(100),
    poids_reel FLOAT,
    poids_reel_timestamp TIMESTAMP WITH TIME ZONE,
    poids_reel_updated_by VARCHAR(100),
    locked BOOLEAN DEFAULT FALSE,
    prix FLOAT,
    commentaire TEXT,
    created_by VARCHAR(100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Index pour améliorer les performances de recherche
CREATE INDEX IF NOT EXISTS idx_performance_achat_date_bete ON performance_achat(date, bete);
CREATE INDEX IF NOT EXISTS idx_performance_achat_id_acheteur ON performance_achat(id_acheteur);
CREATE INDEX IF NOT EXISTS idx_performance_achat_date ON performance_achat(date);

-- =====================================================
-- TABLE: audit_client_logs
-- Description: Logs d'audit des recherches clients
-- =====================================================
CREATE TABLE IF NOT EXISTS audit_client_logs (
    id SERIAL PRIMARY KEY,
    user_id INTEGER,
    username VARCHAR(100) NOT NULL,
    point_de_vente VARCHAR(100),
    phone_number_searched VARCHAR(20) NOT NULL,
    client_name VARCHAR(255),
    search_timestamp TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    consultation_start TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    consultation_end TIMESTAMP WITH TIME ZONE,
    consultation_duration_seconds INTEGER,
    search_success BOOLEAN NOT NULL DEFAULT TRUE,
    total_orders_found INTEGER DEFAULT 0,
    error_message TEXT,
    ip_address VARCHAR(45),
    user_agent TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Index pour améliorer les performances de recherche
CREATE INDEX IF NOT EXISTS idx_audit_client_logs_username ON audit_client_logs(username);
CREATE INDEX IF NOT EXISTS idx_audit_client_logs_phone ON audit_client_logs(phone_number_searched);
CREATE INDEX IF NOT EXISTS idx_audit_client_logs_timestamp ON audit_client_logs(search_timestamp);

-- =====================================================
-- VÉRIFICATION
-- =====================================================
-- Afficher les tables créées
SELECT table_name FROM information_schema.tables 
WHERE table_schema = 'public' 
ORDER BY table_name;

-- =====================================================
-- FIN DU SCRIPT
-- =====================================================

