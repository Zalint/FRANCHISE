-- Migration: Création de la table audit_client_logs
-- Description: Tracking des recherches dans l'Audit Client
-- Date: 2025-11-18

-- Création de la table
CREATE TABLE IF NOT EXISTS audit_client_logs (
    id SERIAL PRIMARY KEY,
    
    -- Qui a fait la recherche
    user_id INTEGER,
    username VARCHAR(100) NOT NULL,
    
    -- Où (point de vente de l'utilisateur si applicable)
    point_de_vente VARCHAR(100),
    
    -- Quoi
    phone_number_searched VARCHAR(20) NOT NULL,
    client_name VARCHAR(255),
    
    -- Quand
    search_timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    consultation_start TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    consultation_end TIMESTAMP,
    consultation_duration_seconds INTEGER,
    
    -- Résultat
    search_success BOOLEAN DEFAULT true NOT NULL,
    total_orders_found INTEGER DEFAULT 0,
    error_message TEXT,
    
    -- Métadonnées
    ip_address VARCHAR(45),
    user_agent TEXT,
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- Index pour optimiser les requêtes fréquentes
CREATE INDEX IF NOT EXISTS idx_audit_logs_username ON audit_client_logs(username);
CREATE INDEX IF NOT EXISTS idx_audit_logs_phone ON audit_client_logs(phone_number_searched);
CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_client_logs(search_timestamp);
CREATE INDEX IF NOT EXISTS idx_audit_logs_point_vente ON audit_client_logs(point_de_vente);
CREATE INDEX IF NOT EXISTS idx_audit_logs_date_range ON audit_client_logs(search_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_success ON audit_client_logs(search_success);

-- Commentaires pour documentation
COMMENT ON TABLE audit_client_logs IS 'Logs des consultations de l''Audit Client pour supervision';
COMMENT ON COLUMN audit_client_logs.username IS 'Nom de l''utilisateur qui a fait la recherche';
COMMENT ON COLUMN audit_client_logs.point_de_vente IS 'Point de vente de l''utilisateur';
COMMENT ON COLUMN audit_client_logs.phone_number_searched IS 'Numéro de téléphone recherché';
COMMENT ON COLUMN audit_client_logs.client_name IS 'Nom du client trouvé';
COMMENT ON COLUMN audit_client_logs.consultation_duration_seconds IS 'Durée de consultation en secondes';
COMMENT ON COLUMN audit_client_logs.search_success IS 'Indique si la recherche a réussi';
COMMENT ON COLUMN audit_client_logs.total_orders_found IS 'Nombre de commandes trouvées pour ce client';

-- Fonction pour mettre à jour updated_at automatiquement
CREATE OR REPLACE FUNCTION update_audit_logs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger pour updated_at
DROP TRIGGER IF EXISTS trigger_audit_logs_updated_at ON audit_client_logs;
CREATE TRIGGER trigger_audit_logs_updated_at
    BEFORE UPDATE ON audit_client_logs
    FOR EACH ROW
    EXECUTE FUNCTION update_audit_logs_updated_at();

-- Afficher le résultat
SELECT 'Table audit_client_logs créée avec succès !' as message;

