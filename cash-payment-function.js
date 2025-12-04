/**
 * Fonction pour ajouter les paiements en espèces à la réconciliation
 * Cette fonction récupère les données de paiement en espèces pour la date sélectionnée
 * et les ajoute au tableau de réconciliation
 */
async function addCashPaymentToReconciliation() {
    console.log("Début de l'intégration des paiements en espèces à la réconciliation");
    
    // Vérifier si le tableau de réconciliation existe
    const reconciliationTable = document.getElementById('reconciliation-table');
    if (!reconciliationTable) {
        console.error("Tableau de réconciliation non trouvé");
        return;
    }
    
    // Vérifier la structure du tableau
    const headerRow = reconciliationTable.querySelector('thead tr');
    if (headerRow) {
        console.log("Structure de l'en-tête du tableau:", 
            Array.from(headerRow.cells).map((cell, idx) => `${idx}: ${cell.textContent.trim()}`));
        console.log("Nombre de cellules dans l'en-tête:", headerRow.cells.length);
    }
    
    const rows = reconciliationTable.querySelectorAll('tbody tr');
    console.log(`Nombre de lignes dans le tableau: ${rows.length}`);
    
    if (rows.length === 0) {
        console.warn("Aucune ligne trouvée dans le tableau de réconciliation");
        return;
    }
    
    // Récupérer la date sélectionnée
    const selectedDate = document.getElementById('date-reconciliation').value;
    console.log("Date sélectionnée pour les paiements en espèces:", selectedDate);
    
    if (!selectedDate) {
        console.warn("Aucune date sélectionnée pour les paiements en espèces");
        return;
    }
    
    // Charger le mapping des références de paiement depuis l'API
    let PAYMENT_REF_MAPPING = {};
    try {
        const mappingResponse = await fetch('/api/payment-ref-mapping');
        if (mappingResponse.ok) {
            const mappingData = await mappingResponse.json();
            if (mappingData.success && mappingData.data) {
                PAYMENT_REF_MAPPING = mappingData.data;
                console.log('Payment ref mapping chargé depuis la BDD:', PAYMENT_REF_MAPPING);
            }
        }
    } catch (error) {
        console.error('Erreur lors du chargement du payment ref mapping:', error);
    }

    // Helper function for mapping normalization
    function getNormalizedPointVente(ref) {
        if (!ref) return 'Non spécifié'; // Handle null/undefined refs
        const upperRef = ref.toUpperCase().replace(/^G_/, 'V_'); // Convert to uppercase and replace G_ with V_
        return PAYMENT_REF_MAPPING[upperRef] || upperRef; // Return mapped name or the normalized ref itself
    }
    
    // Récupérer les données de paiement
    try {
        console.log("Récupération des données de paiement depuis l'API...");
        const response = await fetch(`/api/cash-payments/aggregated`, {
            method: 'GET',
            credentials: 'include'
        });
        
        const result = await response.json();
        console.log("Réponse de l'API de paiements en espèces:", result);
        
        if (result.success && result.data && Array.isArray(result.data)) {
            console.log("Cash payments: recherche pour date", selectedDate, "dans", result.data.length, "entrées");
            
            // Rechercher les données pour la date sélectionnée
            const dateData = result.data.find(entry => {
                if (!entry.date) return false;
                
                // Normaliser la date de l'entrée
                let entryDateStr = entry.date;
                if (entry.date instanceof Date) {
                    entryDateStr = entry.date.toISOString().split('T')[0];
                } else if (typeof entry.date === 'string' && entry.date.includes('T')) {
                    entryDateStr = entry.date.split('T')[0];
                }
                
                const parts = entryDateStr.split('-');
                if (parts.length !== 3) return false;
                
                const formattedEntryDate = `${parts[2]}/${parts[1]}/${parts[0]}`;
                return formattedEntryDate === selectedDate;
            });
            
            if (dateData && dateData.points) {
                console.log("Données de paiement trouvées pour la date:", dateData);
                
                // Construire l'objet de données avec le mapping des points de vente
                const cashPaymentData = {};
                dateData.points.forEach(point => {
                    // Utiliser la fonction de normalisation ici
                    const pointVenteStandard = getNormalizedPointVente(point.point);
                    // Ensure aggregation if multiple refs map to the same name
                    cashPaymentData[pointVenteStandard] = (cashPaymentData[pointVenteStandard] || 0) + point.total;
                });
                
                console.log("Données de paiement en espèces préparées (après normalisation):", cashPaymentData);
                
                // Vérifier si la colonne "Montant Total Cash" existe déjà
                let cashColumnExists = false;
                let ecartCashColumnExists = false;
                
                if (headerRow) {
                    Array.from(headerRow.cells).forEach((cell, index) => {
                        const cellText = cell.textContent.trim();
                        if (cellText === "Montant Total Cash") {
                            cashColumnExists = true;
                            console.log("Colonne 'Montant Total Cash' trouvée à l'index", index);
                        }
                        if (cellText === "Ecart Cash") {
                            ecartCashColumnExists = true;
                            console.log("Colonne 'Ecart Cash' trouvée à l'index", index);
                        }
                    });
                }
                
                // S'il n'y a pas de colonne pour les paiements en espèces, l'ajouter
                if (!cashColumnExists || !ecartCashColumnExists) {
                    // Ajouter les colonnes nécessaires à l'en-tête
                    const ecartColumnIndex = Array.from(headerRow.cells).findIndex(
                        cell => cell.textContent.trim() === "Écart %"
                    );
                    
                    if (ecartColumnIndex !== -1) {
                        if (!cashColumnExists) {
                            const cashHeader = document.createElement('th');
                            cashHeader.textContent = "Montant Total Cash";
                            cashHeader.classList.add('text-end');
                            headerRow.insertBefore(cashHeader, headerRow.cells[ecartColumnIndex + 1]);
                            console.log("Colonne 'Montant Total Cash' ajoutée");
                        }
                        
                        if (!ecartCashColumnExists) {
                            const ecartCashHeader = document.createElement('th');
                            ecartCashHeader.textContent = "Ecart Cash";
                            ecartCashHeader.classList.add('text-end');
                            headerRow.insertBefore(ecartCashHeader, headerRow.cells[ecartColumnIndex + (cashColumnExists ? 2 : 1)]);
                            console.log("Colonne 'Ecart Cash' ajoutée");
                        }
                        
                        // Ajouter une cellule pour chaque ligne
                        rows.forEach(row => {
                            if (!cashColumnExists) {
                                const cashCell = document.createElement('td');
                                cashCell.classList.add('currency');
                                row.insertBefore(cashCell, row.cells[ecartColumnIndex + 1]);
                            }
                            
                            if (!ecartCashColumnExists) {
                                const ecartCashCell = document.createElement('td');
                                ecartCashCell.classList.add('currency');
                                row.insertBefore(ecartCashCell, row.cells[ecartColumnIndex + (cashColumnExists ? 2 : 1)]);
                            }
                        });
                    }
                }
                
                // Maintenant que les colonnes existent, mettre à jour les données
                // Trouver les index des colonnes importantes
                const headerCells = Array.from(headerRow.cells).map(cell => cell.textContent.trim());
                const cashColumnIndex = headerCells.indexOf("Montant Total Cash");
                const ecartCashColumnIndex = headerCells.indexOf("Ecart Cash");
                const ventesSaisiesColumnIndex = headerCells.indexOf("Ventes Saisies");
                
                console.log("Index des colonnes: Cash=", cashColumnIndex, "EcartCash=", ecartCashColumnIndex, "VentesSaisies=", ventesSaisiesColumnIndex);
                
                if (cashColumnIndex === -1 || ecartCashColumnIndex === -1 || ventesSaisiesColumnIndex === -1) {
                    console.error("Impossible de trouver toutes les colonnes nécessaires");
                    return;
                }
                
                // Mettre à jour chaque ligne avec les données de paiement
                rows.forEach(row => {
                    // Utiliser la normalisation aussi pour lire l'attribut
                    const pointVenteAttr = row.getAttribute('data-point-vente');
                    const pointVente = getNormalizedPointVente(pointVenteAttr); 
                    
                    if (!pointVente) {
                        console.warn("Ligne sans attribut data-point-vente ou ref non mappable:", pointVenteAttr);
                        return;
                    }
                    
                    // Obtenir les valeurs
                    const cashValue = cashPaymentData[pointVente] || 0;
                    const ventesCell = row.cells[ventesSaisiesColumnIndex];
                    const ventesSaisies = extractNumericValue(ventesCell?.textContent);
                    
                    // Mettre à jour la cellule de cash payment avec édition inline
                    const cashCell = row.cells[cashColumnIndex];
                    if (cashCell) {
                        // Clear previous content
                        cashCell.innerHTML = ''; 
                        cashCell.classList.add('currency');

                        const amountSpan = document.createElement('span');
                        amountSpan.textContent = formatMonetaire(cashValue);
                        amountSpan.style.marginRight = '5px'; // Add some space

                        const editIcon = document.createElement('span');
                        editIcon.textContent = '✏️'; // Simple pencil emoji
                        editIcon.style.cursor = 'pointer';
                        editIcon.title = 'Modifier le montant'; // Tooltip

                        cashCell.appendChild(amountSpan);
                        cashCell.appendChild(editIcon);

                        // Event listener for editing
                        editIcon.addEventListener('click', () => {
                            const currentValue = extractNumericValue(amountSpan.textContent);
                            cashCell.innerHTML = ''; // Clear cell

                            const input = document.createElement('input');
                            input.type = 'number';
                            input.value = currentValue;
                            input.style.width = '100px'; // Adjust width as needed
                            input.classList.add('form-control', 'form-control-sm'); // Add some bootstrap styling if available
                            
                            cashCell.appendChild(input);
                            input.focus();

                            // Function to finish editing
                            const finishEdit = () => {
                                const newValue = parseFloat(input.value) || 0;
                                amountSpan.textContent = formatMonetaire(newValue);
                                
                                // Recalculate Ecart Cash based on new value
                                const newEcartCash = newValue - ventesSaisies;
                                const ecartCashCell = row.cells[ecartCashColumnIndex];
                                if (ecartCashCell) {
                                    ecartCashCell.textContent = formatMonetaire(newEcartCash);
                                    ecartCashCell.classList.remove('positive', 'negative'); // Clear previous styles
                                    if (newEcartCash < 0) {
                                        ecartCashCell.classList.add('negative');
                                    } else if (newEcartCash > 0) {
                                        ecartCashCell.classList.add('positive');
                                    }
                                }

                                cashCell.innerHTML = ''; // Clear again
                                cashCell.appendChild(amountSpan);
                                cashCell.appendChild(editIcon);
                                console.log(`Value updated for ${pointVente} to ${newValue}. Ecart recalculated.`);
                                // Here you would ideally trigger an API call to save the new value
                            };

                            // Save on blur
                            input.addEventListener('blur', finishEdit);

                            // Save on Enter key
                            input.addEventListener('keydown', (e) => {
                                if (e.key === 'Enter') {
                                    input.blur(); // Trigger blur to finish edit
                                }
                                if (e.key === 'Escape') {
                                    // Cancel: Restore original value and view
                                    amountSpan.textContent = formatMonetaire(cashValue); // Restore original
                                    cashCell.innerHTML = '';
                                    cashCell.appendChild(amountSpan);
                                    cashCell.appendChild(editIcon);
                                }
                            });
                        });
                    }
                    
                    // Calculer et afficher l'écart cash initial
                    const ecartCash = cashValue - ventesSaisies;
                    const ecartCashCell = row.cells[ecartCashColumnIndex];
                    if (ecartCashCell) {
                        ecartCashCell.textContent = formatMonetaire(ecartCash);
                        ecartCashCell.classList.add('currency');
                        
                        // Appliquer un style basé sur la valeur
                        if (ecartCash < 0) {
                            ecartCashCell.classList.add('negative');
                        } else if (ecartCash > 0) {
                            ecartCashCell.classList.add('positive');
                        }
                    }
                    
                    console.log(`${pointVente}: Cash=${cashValue}, Ventes=${ventesSaisies}, Ecart=${ecartCash}`);
                });
                
                console.log("Mise à jour des paiements en espèces terminée");
            } else {
                console.log("Aucune donnée de paiement trouvée pour la date:", selectedDate);
            }
        } else {
            console.warn("Réponse API invalide:", result);
        }
    } catch (error) {
        console.error("Erreur lors de la récupération ou de l'affichage des données de paiement:", error);
    }
}

// Fonction utilitaire pour extraire une valeur numérique d'un texte formaté
function extractNumericValue(formattedText) {
    if (typeof formattedText !== 'string' || !formattedText) return 0;
    
    // Supprimer les espaces insécables et autres espaces, puis les caractères non numériques sauf le point/virgule
    const numericString = formattedText.replace(/\s|\u00A0/g, '') // Remove spaces (incl. non-breaking)
                                     .replace(/[^\d.,-]/g, '')    // Keep digits, comma, dot, minus
                                     .replace(',', '.');          // Replace comma with dot
    
    return parseFloat(numericString) || 0;
}

// Assume formatMonetaire exists elsewhere, provide a dummy if needed for testing
if (typeof formatMonetaire === 'undefined') {
    function formatMonetaire(value) {
        // Basic placeholder formatting
        return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'XOF' }).format(value);
    }
}

// Exporter les fonctions pour les tests
// If this script is run directly in the browser (not as a Node module), 
// module.exports will cause an error. Check if module exists.
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        addCashPaymentToReconciliation,
        extractNumericValue,
        // Potentially export getNormalizedPointVente if needed for tests
    };
} 