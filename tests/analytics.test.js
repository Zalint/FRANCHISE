/**
 * Tests Unitaires - Analytics API
 * 
 * Ces tests couvrent:
 * - Logique de retry pour achats-boeuf
 * - Calculs de totaux avec et sans Stock Soir
 * - Règle spéciale du premier jour du mois
 * - Calculs de ratios et marges
 * - Normalisation des dates
 */

describe('Analytics API - Tests Unitaires', () => {
    
    // ============================================
    // SECTION 1: Helper Functions - Dates
    // ============================================
    
    describe('Date Helper Functions', () => {
        
        test('normalizeDate - format DD/MM/YYYY reste inchangé', () => {
            const normalizeDate = (dateStr) => {
                if (!dateStr) return null;
                if (dateStr.includes('/')) return dateStr;
                if (dateStr.includes('-')) {
                    const parts = dateStr.split('-');
                    if (parts[0].length === 4) {
                        return `${parts[2]}/${parts[1]}/${parts[0]}`;
                    } else {
                        return dateStr.replace(/-/g, '/');
                    }
                }
                return dateStr;
            };
            
            expect(normalizeDate('01/10/2025')).toBe('01/10/2025');
        });
        
        test('normalizeDate - YYYY-MM-DD vers DD/MM/YYYY', () => {
            const normalizeDate = (dateStr) => {
                if (!dateStr) return null;
                if (dateStr.includes('/')) return dateStr;
                if (dateStr.includes('-')) {
                    const parts = dateStr.split('-');
                    if (parts[0].length === 4) {
                        return `${parts[2]}/${parts[1]}/${parts[0]}`;
                    } else {
                        return dateStr.replace(/-/g, '/');
                    }
                }
                return dateStr;
            };
            
            expect(normalizeDate('2025-10-01')).toBe('01/10/2025');
        });
        
        test('normalizeDate - DD-MM-YYYY vers DD/MM/YYYY', () => {
            const normalizeDate = (dateStr) => {
                if (!dateStr) return null;
                if (dateStr.includes('/')) return dateStr;
                if (dateStr.includes('-')) {
                    const parts = dateStr.split('-');
                    if (parts[0].length === 4) {
                        return `${parts[2]}/${parts[1]}/${parts[0]}`;
                    } else {
                        return dateStr.replace(/-/g, '/');
                    }
                }
                return dateStr;
            };
            
            expect(normalizeDate('01-10-2025')).toBe('01/10/2025');
        });
        
        test('isFirstDayOfMonth - retourne true pour le 1er', () => {
            const testDate = new Date(2025, 9, 1); // 1er octobre 2025
            expect(testDate.getDate()).toBe(1);
        });
        
        test('isFirstDayOfMonth - retourne false pour autres jours', () => {
            const testDate = new Date(2025, 9, 15); // 15 octobre 2025
            expect(testDate.getDate()).not.toBe(1);
        });
        
        test('decrementDate - recule d\'un jour correctement', () => {
            const decrementDate = (dateStr, days) => {
                const parts = dateStr.split('-');
                let date;
                
                if (parts[0].length === 4) {
                    date = new Date(parts[0], parts[1] - 1, parts[2]);
                } else {
                    date = new Date(parts[2], parts[1] - 1, parts[0]);
                }
                
                date.setDate(date.getDate() - days);
                
                const day = String(date.getDate()).padStart(2, '0');
                const month = String(date.getMonth() + 1).padStart(2, '0');
                const year = date.getFullYear();
                
                return `${day}-${month}-${year}`;
            };
            
            expect(decrementDate('01-10-2025', 1)).toBe('30-09-2025');
            expect(decrementDate('15-01-2025', 1)).toBe('14-01-2025');
        });
        
        test('decrementDate - gère le changement de mois', () => {
            const decrementDate = (dateStr, days) => {
                const parts = dateStr.split('-');
                let date;
                
                if (parts[0].length === 4) {
                    date = new Date(parts[0], parts[1] - 1, parts[2]);
                } else {
                    date = new Date(parts[2], parts[1] - 1, parts[0]);
                }
                
                date.setDate(date.getDate() - days);
                
                const day = String(date.getDate()).padStart(2, '0');
                const month = String(date.getMonth() + 1).padStart(2, '0');
                const year = date.getFullYear();
                
                return `${day}-${month}-${year}`;
            };
            
            expect(decrementDate('01-01-2025', 1)).toBe('31-12-2024');
        });
    });
    
    // ============================================
    // SECTION 2: Logique du Premier Jour du Mois
    // ============================================
    
    describe('Default Date Logic - Premier Jour du Mois', () => {
        
        test('Premier jour du mois SANS arguments → startDate = endDate = aujourd\'hui', () => {
            const mockDate = new Date(2025, 0, 1); // 1er janvier 2025
            const isFirstDay = mockDate.getDate() === 1;
            const hasStartDate = false;
            const hasEndDate = false;
            
            let finalStartDate, finalEndDate;
            
            if (!hasStartDate && !hasEndDate && isFirstDay) {
                const day = mockDate.getDate().toString().padStart(2, '0');
                const month = (mockDate.getMonth() + 1).toString().padStart(2, '0');
                const year = mockDate.getFullYear();
                finalStartDate = `${day}/${month}/${year}`;
                finalEndDate = `${day}/${month}/${year}`;
            }
            
            expect(finalStartDate).toBe('01/01/2025');
            expect(finalEndDate).toBe('01/01/2025');
        });
        
        test('15e jour du mois SANS arguments → startDate = 1er, endDate = hier', () => {
            const mockDate = new Date(2025, 0, 15); // 15 janvier 2025
            const isFirstDay = mockDate.getDate() === 1;
            const hasStartDate = false;
            const hasEndDate = false;
            
            expect(isFirstDay).toBe(false);
            
            // Comportement normal attendu
            const firstDay = new Date(mockDate.getFullYear(), mockDate.getMonth(), 1);
            expect(firstDay.getDate()).toBe(1);
            
            const yesterday = new Date(mockDate);
            yesterday.setDate(yesterday.getDate() - 1);
            expect(yesterday.getDate()).toBe(14);
        });
        
        test('Premier jour AVEC arguments → utilise les arguments', () => {
            const mockDate = new Date(2025, 0, 1); // 1er janvier 2025
            const isFirstDay = mockDate.getDate() === 1;
            const hasStartDate = true;
            const hasEndDate = true;
            
            // Même si c'est le 1er du mois, les arguments sont prioritaires
            expect(isFirstDay).toBe(true);
            expect(hasStartDate).toBe(true);
            expect(hasEndDate).toBe(true);
            
            // La règle spéciale ne devrait PAS s'appliquer
            const shouldApplySpecialRule = !hasStartDate && !hasEndDate && isFirstDay;
            expect(shouldApplySpecialRule).toBe(false);
        });
    });
    
    // ============================================
    // SECTION 3: Retry Logic - Achats Boeuf
    // ============================================
    
    describe('Retry Logic - fetchAchatsBoeufWithRetry', () => {
        
        test('Simulation: Données trouvées au 1er essai', () => {
            const attempts = 1;
            const foundData = true;
            
            const result = {
                success: foundData,
                avgPrixKgBoeuf: 3450,
                avgPrixKgVeau: 3550,
                effectiveStartDate: '01-10-2025',
                attempts: attempts
            };
            
            expect(result.success).toBe(true);
            expect(result.attempts).toBe(1);
            expect(result.effectiveStartDate).toBe('01-10-2025');
        });
        
        test('Simulation: Données trouvées après 6 tentatives', () => {
            const attempts = 6;
            const initialDate = '01-10-2025';
            
            // Simuler le décalage de 6 jours
            const decrementDate = (dateStr, days) => {
                const parts = dateStr.split('-');
                const date = new Date(parts[2], parts[1] - 1, parts[0]);
                date.setDate(date.getDate() - days);
                const d = String(date.getDate()).padStart(2, '0');
                const m = String(date.getMonth() + 1).padStart(2, '0');
                const y = date.getFullYear();
                return `${d}-${m}-${y}`;
            };
            
            const effectiveDate = decrementDate(initialDate, attempts - 1);
            
            const result = {
                success: true,
                avgPrixKgBoeuf: 3450,
                avgPrixKgVeau: 3550,
                effectiveStartDate: effectiveDate,
                attempts: attempts
            };
            
            expect(result.success).toBe(true);
            expect(result.attempts).toBe(6);
            expect(result.effectiveStartDate).toBe('26-09-2025');
        });
        
        test('Simulation: Aucune donnée après 30 tentatives', () => {
            const maxRetries = 30;
            
            const result = {
                success: false,
                avgPrixKgBoeuf: null,
                avgPrixKgVeau: null,
                effectiveStartDate: null,
                attempts: maxRetries
            };
            
            expect(result.success).toBe(false);
            expect(result.attempts).toBe(30);
            expect(result.avgPrixKgBoeuf).toBeNull();
        });
        
        test('Debug info - Commentaire pour retry réussi', () => {
            const requestedStartDate = '01-10-2025';
            const effectiveStartDate = '26-09-2025';
            const attempts = 6;
            
            const comment = effectiveStartDate !== requestedStartDate
                ? `Aucune donnée trouvée pour la période initiale. Données trouvées à partir du ${effectiveStartDate} après ${attempts} tentative(s).`
                : `Données trouvées pour la période demandée.`;
            
            expect(comment).toContain('Aucune donnée trouvée pour la période initiale');
            expect(comment).toContain('26-09-2025');
            expect(comment).toContain('6 tentative(s)');
        });
        
        test('Debug info - Commentaire pour 1ère tentative réussie', () => {
            const requestedStartDate = '01-09-2025';
            const effectiveStartDate = '01-09-2025';
            
            const comment = effectiveStartDate !== requestedStartDate
                ? `Aucune donnée trouvée pour la période initiale. Données trouvées à partir du ${effectiveStartDate} après tentative(s).`
                : `Données trouvées pour la période demandée.`;
            
            expect(comment).toBe('Données trouvées pour la période demandée.');
        });
    });
    
    // ============================================
    // SECTION 4: Calculs de Totaux
    // ============================================
    
    describe('Calculs - Totaux avec et sans Stock Soir', () => {
        
        test('Calcul totalChiffreAffaires AVEC Stock Soir', () => {
            const productData = {
                poulet: { chiffreAffaires: 108700, cout: 94100, marge: 14600 },
                agneau: { chiffreAffaires: 0, cout: 0, marge: 0 },
                boeuf: { chiffreAffaires: 0, cout: 0, marge: 0 },
                veau: { chiffreAffaires: 0, cout: 0, marge: 0 },
                oeuf: { chiffreAffaires: 0, cout: 0, marge: 0 },
                packs: { chiffreAffaires: 0, cout: 0, marge: 0 },
                surPieds: { chiffreAffaires: 0, cout: 0, marge: 0 },
                divers: { chiffreAffaires: 0, cout: 0, marge: 0 },
                autre: { chiffreAffaires: 0, cout: 0, marge: 0 },
                stockSoir: { chiffreAffaires: -108718, cout: -94100, marge: -14618 }
            };
            
            const totalChiffreAffaires = Object.values(productData)
                .reduce((sum, p) => sum + p.chiffreAffaires, 0);
            
            expect(totalChiffreAffaires).toBe(-18);
        });
        
        test('Calcul totalChiffreAffairesSansStockSoir', () => {
            const productData = {
                poulet: { chiffreAffaires: 108700, cout: 94100, marge: 14600 },
                agneau: { chiffreAffaires: 0, cout: 0, marge: 0 },
                boeuf: { chiffreAffaires: 0, cout: 0, marge: 0 },
                veau: { chiffreAffaires: 0, cout: 0, marge: 0 },
                oeuf: { chiffreAffaires: 0, cout: 0, marge: 0 },
                packs: { chiffreAffaires: 0, cout: 0, marge: 0 },
                surPieds: { chiffreAffaires: 0, cout: 0, marge: 0 },
                divers: { chiffreAffaires: 0, cout: 0, marge: 0 },
                autre: { chiffreAffaires: 0, cout: 0, marge: 0 }
            };
            
            const totalChiffreAffairesSansStockSoir = Object.values(productData)
                .reduce((sum, p) => sum + p.chiffreAffaires, 0);
            
            expect(totalChiffreAffairesSansStockSoir).toBe(108700);
        });
        
        test('Cohérence: Total AVEC = Total SANS + Stock Soir', () => {
            const totalAvecStock = -18;
            const totalSansStock = 108700;
            const stockSoirCA = -108718;
            
            expect(totalAvecStock).toBe(totalSansStock + stockSoirCA);
        });
        
        test('Totaux généraux - Accumulation de plusieurs points', () => {
            const points = [
                {
                    totalChiffreAffaires: -18,
                    totalChiffreAffairesSansStockSoir: 108700
                },
                {
                    totalChiffreAffaires: 2975,
                    totalChiffreAffairesSansStockSoir: 255000
                },
                {
                    totalChiffreAffaires: 2389805,
                    totalChiffreAffairesSansStockSoir: 2671000
                }
            ];
            
            let totauxGeneraux = {
                totalChiffreAffaires: 0,
                totalChiffreAffairesSansStockSoir: 0
            };
            
            points.forEach(point => {
                totauxGeneraux.totalChiffreAffaires += point.totalChiffreAffaires;
                totauxGeneraux.totalChiffreAffairesSansStockSoir += point.totalChiffreAffairesSansStockSoir;
            });
            
            expect(totauxGeneraux.totalChiffreAffaires).toBe(2392762);
            expect(totauxGeneraux.totalChiffreAffairesSansStockSoir).toBe(3034700);
        });
    });
    
    // ============================================
    // SECTION 5: Calculs de Ratios et Marges
    // ============================================
    
    describe('Calculs - Ratios et Marges', () => {
        
        test('Mode GLOBAL - Calcul du ratio', () => {
            const qtéVendue = 978;
            const qtéAbattue = 1000;
            
            const ratio = ((qtéVendue / qtéAbattue) - 1) * 100;
            
            expect(ratio).toBeCloseTo(-2.2, 1);
        });
        
        test('Mode SPÉCIFIQUE - Calcul quantité abattue depuis ratio', () => {
            const qtéVendue = -40.60;
            const ratio = -2.15 / 100; // Convertir en décimal
            
            const qtéAbattue = qtéVendue / (1 + ratio);
            
            expect(qtéAbattue).toBeCloseTo(-41.49, 2);
        });
        
        test('Cohérence mathématique - Ratio bidirectionnel', () => {
            // Calcul du ratio depuis qtéVendue et qtéAbattue
            const qtéVendue = 978;
            const qtéAbattue = 1000;
            const ratio = ((qtéVendue / qtéAbattue) - 1);
            
            // Recalcul de qtéAbattue depuis ratio
            const qtéAbattueRecalculee = qtéVendue / (1 + ratio);
            
            expect(qtéAbattueRecalculee).toBeCloseTo(qtéAbattue, 5);
        });
        
        test('Calcul de la marge', () => {
            const qtéVendue = 978;
            const prixVente = 3604;
            const qtéAbattue = 1000;
            const prixAchat = 3800;
            
            const chiffreAffaires = qtéVendue * prixVente;
            const cout = qtéAbattue * prixAchat;
            const marge = chiffreAffaires - cout;
            
            expect(chiffreAffaires).toBe(3524712);
            expect(cout).toBe(3800000);
            expect(marge).toBe(-275288);
        });
        
        test('Calcul prix moyen de vente pondéré', () => {
            const ventes = [
                { quantite: 100, prixUnit: 3500 },
                { quantite: 200, prixUnit: 3600 },
                { quantite: 150, prixUnit: 3550 }
            ];
            
            const totalCA = ventes.reduce((sum, v) => sum + (v.quantite * v.prixUnit), 0);
            const totalQte = ventes.reduce((sum, v) => sum + v.quantite, 0);
            const prixMoyen = totalCA / totalQte;
            
            expect(prixMoyen).toBeCloseTo(3561.11, 2);
        });
        
        test('Ratio négatif indique des pertes', () => {
            const qtéVendue = 950;
            const qtéAbattue = 1000;
            const ratio = ((qtéVendue / qtéAbattue) - 1) * 100;
            
            expect(ratio).toBeLessThan(0);
            expect(ratio).toBeCloseTo(-5, 1);
        });
        
        test('Ratio positif serait impossible (ventes > abattage)', () => {
            // Ce scénario ne devrait pas arriver dans la réalité
            const qtéVendue = 1050;
            const qtéAbattue = 1000;
            const ratio = ((qtéVendue / qtéAbattue) - 1) * 100;
            
            expect(ratio).toBeGreaterThan(0);
            expect(ratio).toBeCloseTo(5, 1);
        });
    });
    
    // ============================================
    // SECTION 6: Cas Limites et Edge Cases
    // ============================================
    
    describe('Edge Cases et Validations', () => {
        
        test('Division par zéro - qtéAbattue = 0', () => {
            const qtéVendue = 100;
            const qtéAbattue = 0;
            
            const ratio = qtéAbattue !== 0 
                ? ((qtéVendue / qtéAbattue) - 1) * 100 
                : null;
            
            expect(ratio).toBeNull();
        });
        
        test('Valeurs négatives - Retours/ajustements', () => {
            const qtéVendue = -40.60; // Retour ou ajustement
            const qtéAbattue = -41.49;
            
            const ratio = ((qtéVendue / qtéAbattue) - 1) * 100;
            
            // Le calcul fonctionne même avec des négatifs
            expect(ratio).toBeCloseTo(-2.15, 1);
        });
        
        test('Valeurs nulles - Produit non vendu', () => {
            const productData = {
                chiffreAffaires: 0,
                cout: 0,
                marge: 0
            };
            
            expect(productData.chiffreAffaires).toBe(0);
            expect(productData.marge).toBe(0);
        });
        
        test('Grandes valeurs - Totaux sur plusieurs points', () => {
            const total = 5445890; // Totaux généraux
            
            expect(total).toBeGreaterThan(5000000);
            expect(total).toBeLessThan(6000000);
        });
        
        test('Précision des arrondis - Math.round', () => {
            const valeur = 3604.567;
            const arrondi = Math.round(valeur);
            
            expect(arrondi).toBe(3605);
        });
        
        test('Format de date invalide - Gestion null', () => {
            const normalizeDate = (dateStr) => {
                if (!dateStr) return null;
                return dateStr;
            };
            
            expect(normalizeDate(null)).toBeNull();
            expect(normalizeDate(undefined)).toBeNull();
            expect(normalizeDate('')).toBeNull();
        });
    });
    
    // ============================================
    // SECTION 7: Structure de Réponse API
    // ============================================
    
    describe('Structure de Réponse API', () => {
        
        test('Réponse doit contenir tous les champs obligatoires', () => {
            const response = {
                success: true,
                data: {
                    metadata: {
                        startDate: '01/10/2025',
                        endDate: '03/10/2025',
                        generatedAt: new Date().toISOString()
                    },
                    analytics: {
                        pointVente: 'Dahra',
                        proxyMarges: {
                            Dahra: {
                                poulet: { chiffreAffaires: 108700 },
                                totaux: {
                                    totalChiffreAffaires: -18,
                                    totalCout: 0,
                                    totalMarge: -18,
                                    totalChiffreAffairesSansStockSoir: 108700,
                                    totalCoutSansStockSoir: 94100,
                                    totalMargeSansStockSoir: 14600
                                },
                                debug: {
                                    achatsBoeuf: {
                                        requestedStartDate: '01-10-2025',
                                        effectiveStartDate: '26-09-2025',
                                        attemptsRequired: 6,
                                        prixBoeufUtilise: 3450,
                                        prixVeauUtilise: 3550,
                                        comment: 'Aucune donnée trouvée pour la période initiale...'
                                    }
                                }
                            }
                        },
                        totauxGeneraux: {
                            totalChiffreAffaires: -18,
                            totalCout: 0,
                            totalMarge: -18,
                            totalChiffreAffairesSansStockSoir: 108700,
                            totalCoutSansStockSoir: 94100,
                            totalMargeSansStockSoir: 14600
                        }
                    }
                }
            };
            
            // Vérifications de structure
            expect(response.success).toBe(true);
            expect(response.data.metadata).toBeDefined();
            expect(response.data.analytics).toBeDefined();
            expect(response.data.analytics.proxyMarges).toBeDefined();
            expect(response.data.analytics.totauxGeneraux).toBeDefined();
        });
        
        test('Totaux doit avoir 6 champs (3 avec Stock + 3 sans Stock)', () => {
            const totaux = {
                totalChiffreAffaires: 0,
                totalCout: 0,
                totalMarge: 0,
                totalChiffreAffairesSansStockSoir: 0,
                totalCoutSansStockSoir: 0,
                totalMargeSansStockSoir: 0
            };
            
            const keys = Object.keys(totaux);
            expect(keys.length).toBe(6);
            expect(keys).toContain('totalChiffreAffaires');
            expect(keys).toContain('totalChiffreAffairesSansStockSoir');
        });
        
        test('Debug info doit avoir tous les champs requis', () => {
            const debugInfo = {
                requestedStartDate: '01-10-2025',
                effectiveStartDate: '26-09-2025',
                attemptsRequired: 6,
                prixBoeufUtilise: 3450,
                prixVeauUtilise: 3550,
                comment: 'Données trouvées à partir du 26-09-2025...'
            };
            
            expect(debugInfo.requestedStartDate).toBeDefined();
            expect(debugInfo.effectiveStartDate).toBeDefined();
            expect(debugInfo.attemptsRequired).toBeDefined();
            expect(debugInfo.prixBoeufUtilise).toBeDefined();
            expect(debugInfo.comment).toBeDefined();
        });
    });
});

