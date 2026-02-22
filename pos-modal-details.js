// ⚠️ DEPRECATED - Ce fichier est en cours de dépréciation
// Les fonctions de ce fichier seront progressivement migrées vers pos.js
// Ne pas ajouter de nouvelles fonctionnalités ici

// Stocker les commandes pour la modal
// Note: commandesData is now defined globally in pos.js

function displayCommandeGroup(commande, container) {
    // Store commande data for modal
    commandesData.set(commande.commandeId, commande);
    
    const item = document.createElement('div');
    item.className = 'transaction-item transaction-commande';
    
    const time = commande.createdAt ? new Date(commande.createdAt).toLocaleTimeString('fr-FR', {
        hour: '2-digit',
        minute: '2-digit'
    }) : 'N/A';
    
    // Count number of lines (not quantities)
    const nombreLignes = (commande.items || []).length;
    
    // Get client info and status from first item
    const firstItem = commande.items[0] || {};
    const clientName = firstItem.nomClient || firstItem['Client Name'];
    const clientPhone = firstItem.numeroClient || firstItem['Client Phone'];
    const currentStatus = firstItem.statut_preparation || 'en_preparation';
    
    // Add status as data attribute for filtering
    item.dataset.status = currentStatus;
    
    let clientInfoSummary = 'Client inconnu';
    if (clientName || clientPhone) {
        clientInfoSummary = `Client: ${clientName || 'Inconnu'}${clientPhone ? ` • ${clientPhone}` : ''}`;
    }
    
    const displayId = commande.commandeId || 'N/A';
    
    // Status badge
    const statusLabels = {
        'sur_place': { label: 'Sur place', icon: 'utensils' },
        'en_preparation': { label: 'En préparation', icon: 'clock' },
        'pret': { label: 'Prêt', icon: 'check-circle' },
        'en_livraison': { label: 'En livraison', icon: 'shipping-fast' }
    };
    const statusInfo = statusLabels[currentStatus] || statusLabels['en_preparation'];
    
    // Status change button (next status)
    let statusButton = '';
    if (currentStatus === 'sur_place') {
        // Pas de bouton de changement de statut pour "sur place"
        statusButton = '';
    } else if (currentStatus === 'en_preparation') {
        statusButton = `<button class="btn-change-status" onclick="event.stopPropagation(); changerStatutCommande('${commande.commandeId}', 'pret')" title="Marquer prêt">
            <i class="fas fa-arrow-right"></i>
        </button>`;
    } else if (currentStatus === 'pret') {
        statusButton = `<button class="btn-change-status" onclick="event.stopPropagation(); changerStatutCommande('${commande.commandeId}', 'en_livraison')" title="En livraison">
            <i class="fas fa-arrow-right"></i>
        </button>`;
    } else if (currentStatus === 'en_livraison') {
        statusButton = `<button class="btn-change-status" onclick="event.stopPropagation(); changerStatutCommande('${commande.commandeId}', 'pret')" title="Retour Prêt">
            <i class="fas fa-arrow-left"></i>
        </button>`;
    }
    
    item.innerHTML = `
        <div class="commande-summary" onclick="afficherDetailsCommande('${commande.commandeId}')">
            <div class="commande-left">
                <div class="commande-time">${time}</div>
            </div>
            <div class="commande-main">
                <div class="commande-title">
                    <span class="order-status-badge ${currentStatus}">
                        <i class="fas fa-${statusInfo.icon}"></i> ${statusInfo.label}
                    </span>
                    ${statusButton}
                </div>
                <div class="commande-title">Commande ${displayId}</div>
                <div class="commande-total-main">${formatCurrency(commande.totalAmount)}</div>
                <div class="commande-client">${clientInfoSummary}</div>
                <div class="commande-count">${nombreLignes} ligne${nombreLignes > 1 ? 's' : ''}</div>
            </div>
            <div class="commande-right">
                <button class="btn-print-commande" onclick="event.stopPropagation(); imprimerFacture('${commande.commandeId}')" title="Facture">
                    <i class="fas fa-print"></i>
                </button>
                ${clientPhone ? `<button class="btn-history-commande" data-phone="${clientPhone}" data-name="${clientName || 'Client'}" title="Historique du client">
                    <i class="fas fa-history"></i>
                </button>` : ''}
                <button class="btn-view-commande" onclick="event.stopPropagation(); afficherDetailsCommande('${commande.commandeId}')" title="Voir les détails">
                    <i class="fas fa-eye"></i>
                </button>
                <button class="btn-whatsapp-commande" onclick="event.stopPropagation(); envoyerFactureWhatsApp('${commande.commandeId}')" title="Envoyer via WhatsApp">
                    <i class="fab fa-whatsapp"></i>
                </button>
            </div>
        </div>
    `;
    
    // Add event listener for history button if phone exists
    if (clientPhone) {
        // We need to add the listener after the element is in the DOM
        setTimeout(() => {
            const historyBtn = item.querySelector('.btn-history-commande');
            if (historyBtn) {
                historyBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const phone = historyBtn.getAttribute('data-phone');
                    const name = historyBtn.getAttribute('data-name');
                    ouvrirHistoriqueClient(phone, name);
                });
            }
        }, 0);
    }
    
    container.appendChild(item);
}

function afficherDetailsCommande(commandeId) {
    const commande = commandesData.get(commandeId);
    if (!commande) {
        showToast('Commande introuvable', 'error');
        return;
    }
    
    // Get client info
    const firstItem = commande.items[0] || {};
    
    const clientName = firstItem.nomClient || firstItem['Client Name'] || firstItem.nom_client;
    const clientPhone = firstItem.numeroClient || firstItem['Client Phone'] || firstItem.numero_client;
    const clientAddress = firstItem.adresseClient || firstItem['Client Address'] || firstItem.adresse_client;
    const clientInstructions = firstItem.instructionsClient || firstItem['Client Instructions'] || firstItem.instructions_client;
    
    const hasInstructions = clientInstructions && clientInstructions.trim() !== '';
    
    let clientHtml = '';
    if (clientName || clientPhone || clientAddress || clientInstructions) {
        clientHtml = `
            <div class="client-info-section">
                <h4><i class="fas fa-user"></i> Informations client</h4>
                ${clientName ? `<p><strong>Nom:</strong> ${clientName}</p>` : ''}
                ${clientPhone ? `<p><strong>Téléphone:</strong> ${clientPhone}</p>` : ''}
                ${clientAddress ? `<p><strong>Adresse:</strong> ${clientAddress}</p>` : ''}
                ${clientInstructions ? `<p><strong>Instructions:</strong> <span style="color: #FF6B35; font-weight: 600;">${clientInstructions}</span></p>` : ''}
            </div>
        `;
    }
    
    // Récupérer les détails de la commande avec le lien Bictorys depuis l'API
    fetch(`/api/orders/${commandeId}/details`, {
        method: 'GET',
        credentials: 'include'
    }).then(response => response.json())
    .then(result => {
        if (result.success && result.data) {
            afficherModalAvecBictorys(commandeId, commande, clientHtml, result.data.bictorysLink);
        } else {
            afficherModalAvecBictorys(commandeId, commande, clientHtml, null);
        }
    }).catch(error => {
        console.error('Erreur récupération détails:', error);
        afficherModalAvecBictorys(commandeId, commande, clientHtml, null);
    });
}

function afficherModalAvecBictorys(commandeId, commande, clientHtml, bictorysLink) {
    const itemsHtml = commande.items.map(item => {
        const nombre = item.Nombre || item.nombre || 1;
        const produit = item.Produit || item.produit || 'Produit';
        const prixUnit = item.PU || item.prixUnit || 0;
        const montant = item.Montant || item.montant || 0;
        
        return `
            <tr>
                <td>${produit}</td>
                <td class="text-center">${nombre}</td>
                <td class="text-right">${formatCurrency(prixUnit)}</td>
                <td class="text-right"><strong>${formatCurrency(montant)}</strong></td>
            </tr>
        `;
    }).join('');
    
    // Récupérer le statut de paiement de manière asynchrone
    getCommandePaymentStatus(commandeId).then(paymentData => {
        const isPaid = (paymentData.posStatus === 'P' || paymentData.posStatus === 'PP' || paymentData.posStatus === 'M');
        const stampClass = paymentData.posStatus === 'M' ? 'manual' : (paymentData.posStatus === 'PP' ? 'partial' : '');
        const stampText = paymentData.posStatus === 'PP' ? 'PAYÉ<br>PARTIELLEMENT' : 'PAYÉ';
        const stampFontSize = paymentData.posStatus === 'PP' ? '1.1rem' : '1.5rem';
        const stampColor = paymentData.posStatus === 'M' ? '#9b59b6' : (paymentData.posStatus === 'PP' ? '#ff9800' : '#e74c3c');
        
        const stampHtml = isPaid ? `
            <div class="paid-stamp-modal ${stampClass}" style="
                position: absolute;
                top: 20px;
                right: 20px;
                border: 3px solid ${stampColor};
                color: ${stampColor};
                font-size: ${stampFontSize};
                font-weight: 900;
                letter-spacing: 6px;
                padding: 8px 30px;
                text-transform: uppercase;
                opacity: 0.7;
                border-radius: 4px;
                transform: rotate(-15deg);
                pointer-events: none;
                z-index: 100;
                line-height: 1.2;
            ">${stampText}</div>
        ` : '';
        
        // Store payment status for printing
        window.currentCommandePaymentStatus = paymentData.posStatus;
        
        const modalBody = document.getElementById('modalCommandeBody');
        const modalContainer = modalBody.parentElement;
        modalContainer.style.position = 'relative';
        
        // Insérer le stamp avant le contenu
        if (isPaid) {
            const existingStamp = modalContainer.querySelector('.paid-stamp-modal');
            if (existingStamp) {
                existingStamp.remove();
            }
            modalContainer.insertAdjacentHTML('afterbegin', stampHtml);
        }
    });
    
    document.getElementById('modalCommandeTitle').textContent = `Commande ${commandeId}`;
    document.getElementById('modalCommandeBody').innerHTML = `
        ${clientHtml}
        <div class="items-section">
            <h4><i class="fas fa-shopping-cart"></i> Articles</h4>
            <table class="table-details">
                <thead>
                    <tr>
                        <th>Produit</th>
                        <th class="text-center">Qté</th>
                        <th class="text-right">Prix Unit.</th>
                        <th class="text-right">Total</th>
                    </tr>
                </thead>
                <tbody>
                    ${itemsHtml}
                </tbody>
                <tfoot>
                    <tr class="total-row">
                        <td colspan="3"><strong>TOTAL</strong></td>
                        <td class="text-right"><strong>${formatCurrency(commande.totalAmount)}</strong></td>
                    </tr>
                </tfoot>
            </table>
        </div>
        ${generateBictorysSection(commandeId, commande.totalAmount, bictorysLink)}
    `;
    
    // Update footer with edit and print buttons
    const modalFooter = document.querySelector('#modalDetailsCommande .modal-footer');
    modalFooter.innerHTML = `
        <button class="btn-delete-modal" onclick="supprimerCommandeDepuisModal('${commandeId}')" style="background: var(--danger-color); color: white;">
            <i class="fas fa-trash"></i> Supprimer
        </button>
        <button class="btn-print-modal" onclick="imprimerTicketThermique('${commandeId}')">
            <i class="fas fa-print"></i> Imprimer (mode papier)
        </button>
        <button class="btn-edit-modal" onclick="modifierCommandeDepuisModal('${commandeId}')">
            <i class="fas fa-edit"></i> Modifier
        </button>
        <button class="btn-cancel" onclick="fermerModalDetailsCommande()">
            Fermer
        </button>
    `;
    
    document.getElementById('modalDetailsCommande').classList.add('active');
}

function supprimerCommandeDepuisModal(commandeId) {
    supprimerCommande(commandeId);
}

function modifierCommandeDepuisModal(commandeId) {
    fermerModalDetailsCommande();
    modifierCommande(commandeId);
}

// Fonction pour générer le PDF côté client et le sauvegarder sur le serveur
async function genererEtSauvegarderPDF(commandeId, factureData, config = null) {
    return new Promise(async (resolve, reject) => {
        try {
            // Vérifier que html2pdf.js est disponible
            if (typeof html2pdf === 'undefined') {
                throw new Error('html2pdf.js n\'est pas chargé. Veuillez recharger la page.');
            }
            // Créer le contenu HTML de la facture (sans les balises HTML complètes)
            const factureContentHTML = `
                <style>
                    .facture-container {
                        font-family: Arial, sans-serif;
                        max-width: 800px;
                        margin: 0 auto;
                        padding: 20px;
                        color: #333;
                    }
                    .facture-header {
                        text-align: center;
                        margin-bottom: 30px;
                        border-bottom: 3px solid #c41e3a;
                        padding-bottom: 20px;
                    }
                    .facture-header h1 {
                        color: #c41e3a;
                        margin: 0 0 10px 0;
                        font-size: 2em;
                    }
                    .facture-header .website {
                        font-size: 1.2em;
                        color: #666;
                        font-weight: 600;
                    }
                    .facture-info {
                        display: flex;
                        justify-content: space-between;
                        margin-bottom: 30px;
                    }
                    .info-section h3 {
                        color: #c41e3a;
                        margin: 0 0 10px 0;
                        font-size: 1.1em;
                    }
                    .info-section p {
                        margin: 5px 0;
                        line-height: 1.6;
                    }
                    table {
                        width: 100%;
                        border-collapse: collapse;
                        margin: 30px 0;
                    }
                    thead {
                        background: #c41e3a;
                        color: white;
                    }
                    th, td {
                        padding: 12px;
                        text-align: left;
                        border-bottom: 1px solid #ddd;
                    }
                    .text-center { text-align: center; }
                    .text-right { text-align: right; }
                    tfoot {
                        font-weight: bold;
                        background: #f5f5f5;
                    }
                    tfoot td {
                        padding: 15px 12px;
                        font-size: 1.2em;
                        border-top: 2px solid #c41e3a;
                    }
                    .facture-footer {
                        text-align: center;
                        margin-top: 50px;
                        padding-top: 20px;
                        border-top: 1px solid #ddd;
                        color: #666;
                        font-size: 0.9em;
                    }
                </style>
                <div class="facture-container">
                    <div class="facture-header">
                        <h1>${config ? config.nom_complet : ''}</h1>
                        <div class="website">${config && config.site_web ? config.site_web : ''}</div>
                        ${config && config.slogan ? `<div class="slogan" style="font-size: 0.9em; color: #666; font-style: italic; margin-top: 5px;">${config.slogan}</div>` : ''}
                    </div>
                    
                    <div class="facture-info">
                        <div class="info-section">
                            <h3>Point de vente</h3>
                            <p><strong>${factureData.pointVente || 'Point de vente'}</strong></p>
                            <p>Date: ${factureData.dateCommande || ''}</p>
                            <p>Heure: ${factureData.heureCommande || ''}</p>
                        </div>
                        
                        <div class="info-section">
                            <h3>Facture N°</h3>
                            <p><strong>${commandeId}</strong></p>
                            ${factureData.clientName ? `
                                <h3 style="margin-top: 20px;">Client</h3>
                                <p>${factureData.clientName}</p>
                                ${factureData.clientPhone ? `<p>Tél: ${factureData.clientPhone}</p>` : ''}
                                ${factureData.clientAddress ? `<p>${factureData.clientAddress}</p>` : ''}
                            ` : ''}
                        </div>
                    </div>
                    
                    <table>
                        <thead>
                            <tr>
                                <th>Produit</th>
                                <th class="text-center">Quantité</th>
                                <th class="text-right">Prix Unitaire</th>
                                <th class="text-right">Total</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${factureData.itemsRows || ''}
                        </tbody>
                        <tfoot>
                            ${factureData.hasValidCredit ? `
                            <tr>
                                <td colspan="3" class="text-right">Sous-total</td>
                                <td class="text-right">${factureData.totalAmount || '0 FCFA'}</td>
                            </tr>
                            <tr style="color: #4CAF50;">
                                <td colspan="3" class="text-right">🎁 Crédit appliqué</td>
                                <td class="text-right">-${factureData.creditUsed || '0 FCFA'}</td>
                            </tr>
                            <tr style="border-top: 2px solid #c41e3a;">
                                <td colspan="3" class="text-right">MONTANT À PAYER</td>
                                <td class="text-right">${factureData.finalAmount || '0 FCFA'}</td>
                            </tr>
                            ` : `
                            <tr>
                                <td colspan="3" class="text-right">TOTAL À PAYER</td>
                                <td class="text-right">${factureData.totalAmount || '0 FCFA'}</td>
                            </tr>
                            `}
                        </tfoot>
                    </table>
                    
                    <div class="facture-footer">
                        <p>${config && config.footer_facture ? config.footer_facture : 'Merci de votre confiance !'}</p>
                        <p><strong>${config ? config.nom_complet : ''}</strong>${config && config.site_web ? ' - ' + config.site_web : ''}</p>
                    </div>
                </div>
            `;
            
            // Créer un élément temporaire pour générer le PDF
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = factureContentHTML;
            // Positionner l'élément hors écran mais visible pour html2canvas
            // html2canvas a besoin que l'élément soit dans le DOM et visible (même si hors écran)
            tempDiv.style.position = 'absolute';
            tempDiv.style.top = '0px';
            tempDiv.style.left = '0px';
            tempDiv.style.width = '800px';
            tempDiv.style.backgroundColor = '#ffffff';
            tempDiv.style.visibility = 'visible';
            tempDiv.style.display = 'block';
            tempDiv.style.opacity = '1';
            // Le placer hors de la vue mais toujours visible pour html2canvas
            tempDiv.style.transform = 'translateX(-10000px)';
            document.body.appendChild(tempDiv);
            
            // Attendre que le contenu soit rendu et que les styles soient appliqués
            await new Promise(resolve => setTimeout(resolve, 300));
            
            // Générer le PDF avec html2pdf.js
            const opt = {
                margin: [10, 10, 10, 10],
                filename: `facture_${commandeId}.pdf`,
                image: { type: 'jpeg', quality: 0.98 },
                html2canvas: { 
                    scale: 2, 
                    useCORS: true,
                    logging: false,
                    letterRendering: true,
                    allowTaint: false
                },
                jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
                pagebreak: { mode: ['avoid-all', 'css', 'legacy'] }
            };
            
            // Trouver le conteneur principal (facture-container)
            const factureContainer = tempDiv.querySelector('.facture-container') || tempDiv.firstElementChild || tempDiv;
            
            // Générer le PDF - utiliser le conteneur principal
            const pdfBlob = await html2pdf().set(opt).from(factureContainer).outputPdf('blob');
            
            // Nettoyer l'élément temporaire
            document.body.removeChild(tempDiv);
            
            // Convertir le blob en base64
            const reader = new FileReader();
            reader.onloadend = async () => {
                const base64data = reader.result.split(',')[1];
                
                // Envoyer le PDF au serveur pour sauvegarde
                try {
                    const response = await fetch('/api/factures/sauvegarder-pdf', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        credentials: 'include',
                        body: JSON.stringify({
                            commandeId: commandeId,
                            pdfBase64: base64data,
                            factureData: factureData
                        })
                    });
                    
                    if (!response.ok) {
                        throw new Error('Erreur lors de la sauvegarde du PDF');
                    }
                    
                    const result = await response.json();
                    resolve(result);
                } catch (error) {
                    reject(error);
                }
            };
            reader.onerror = () => reject(new Error('Erreur lors de la lecture du PDF'));
            reader.readAsDataURL(pdfBlob);
            
        } catch (error) {
            reject(error);
        }
    });
}

async function imprimerFacture(commandeId) {
    const commande = commandesData.get(commandeId);
    if (!commande) {
        showToast('Commande introuvable', 'error');
        return;
    }
    
    // Récupérer le statut de paiement
    let paymentStatus = 'A';
    let montantRestantDu = 0;
    try {
        const paymentData = await getCommandePaymentStatus(commandeId);
        paymentStatus = paymentData.posStatus || 'A';
        montantRestantDu = paymentData.montantRestantDu || 0;
    } catch (error) {
        console.warn('Impossible de récupérer le statut de paiement:', error);
    }
    
    // Get brand config (pass commandeId to detect brand)
    const config = typeof getBrandConfig === 'function' ? getBrandConfig(commandeId) : null;
    
    // Get point de vente
    const pointVente = document.getElementById('pointVenteSelect')?.value || 'Point de vente';
    
    // Get client info
    const firstItem = commande.items[0] || {};
    const clientName = firstItem.nomClient || firstItem['Client Name'] || '';
    const clientPhone = firstItem.numeroClient || firstItem['Client Phone'] || '';
    const clientAddress = firstItem.adresseClient || firstItem['Client Address'] || '';
    
    // 🆕 Extraire les infos de crédit
    const creditUsed = firstItem.extension?.credit_used || 0;
    const creditStatus = firstItem.extension?.credit_status || null;
    const amountPaidAfterCredit = firstItem.extension?.amount_paid_after_credit || null;
    
    // Crédit valide si > 0 et status !== 'failed'
    const hasValidCredit = creditUsed > 0 && creditStatus !== 'failed';
    const finalAmount = hasValidCredit ? (amountPaidAfterCredit || (commande.totalAmount - creditUsed)) : commande.totalAmount;
    
    // Get date
    const dateCommande = firstItem.Date || firstItem.date || new Date().toLocaleDateString('fr-FR');
    const heureCommande = commande.createdAt ? new Date(commande.createdAt).toLocaleTimeString('fr-FR', {
        hour: '2-digit',
        minute: '2-digit'
    }) : '';
    
    // Build items rows
    const itemsRows = commande.items.map(item => {
        const nombre = item.Nombre || item.nombre || 1;
        const produit = item.Produit || item.produit || 'Produit';
        const prixUnit = item.PU || item.prixUnit || 0;
        const montant = item.Montant || item.montant || 0;
        
        return `
            <tr>
                <td>${produit}</td>
                <td class="text-center">${nombre}</td>
                <td class="text-right">${formatCurrency(prixUnit)}</td>
                <td class="text-right">${formatCurrency(montant)}</td>
            </tr>
        `;
    }).join('');
    
    // Préparer les données pour l'API
    const factureData = {
        pointVente: pointVente,
        dateCommande: dateCommande,
        heureCommande: heureCommande,
        clientName: clientName,
        clientPhone: clientPhone,
        clientAddress: clientAddress,
        clientInstructions: clientInstructions,
        itemsRows: itemsRows,
        totalAmount: formatCurrency(commande.totalAmount),
        // 🆕 Infos de crédit
        hasValidCredit: hasValidCredit,
        creditUsed: hasValidCredit ? formatCurrency(creditUsed) : null,
        finalAmount: hasValidCredit ? formatCurrency(finalAmount) : null
    };
    
    try {
        // Générer le PDF côté client et le sauvegarder
        showToast('Génération du PDF en cours...', 'info');
        
        const result = await genererEtSauvegarderPDF(commandeId, factureData, config);
        
        if (result.success && result.pdfUrl) {
            // Télécharger le PDF directement
            window.location.href = result.pdfUrl;
            showToast('PDF généré avec succès !', 'success');
        } else {
            throw new Error('Réponse invalide du serveur');
        }
        
    } catch (error) {
        console.error('Erreur génération PDF:', error);
        // Pas de popup d'erreur affiché à l'utilisateur
        
        // Fallback: ouvrir la fenêtre d'impression HTML classique
        const factureHTML = `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <title>Facture ${commandeId}</title>
                <style>
                    @media print {
                        @page { margin: 1cm; }
                        body { margin: 0; }
                    }
                    
                    body {
                        font-family: Arial, sans-serif;
                        max-width: 800px;
                        margin: 0 auto;
                        padding: 20px;
                        color: #333;
                    }
                    
                    .facture-header {
                        text-align: center;
                        margin-bottom: 30px;
                        border-bottom: 3px solid #c41e3a;
                        padding-bottom: 20px;
                    }
                    
                    .facture-header h1 {
                        color: #c41e3a;
                        margin: 0 0 10px 0;
                        font-size: 2em;
                    }
                    
                    .facture-header .website {
                        font-size: 1.2em;
                        color: #666;
                        font-weight: 600;
                    }
                    
                    .facture-info {
                        display: flex;
                        justify-content: space-between;
                        margin-bottom: 30px;
                    }
                    
                    .info-section h3 {
                        color: #c41e3a;
                        margin: 0 0 10px 0;
                        font-size: 1.1em;
                    }
                    
                    .info-section p {
                        margin: 5px 0;
                        line-height: 1.6;
                    }
                    
                    table {
                        width: 100%;
                        border-collapse: collapse;
                        margin: 30px 0;
                    }
                    
                    thead {
                        background: #c41e3a;
                        color: white;
                    }
                    
                    th, td {
                        padding: 12px;
                        text-align: left;
                        border-bottom: 1px solid #ddd;
                    }
                    
                    .text-center { text-align: center; }
                    .text-right { text-align: right; }
                    
                    tbody tr:hover {
                        background: #f9f9f9;
                    }
                    
                    tfoot {
                        font-weight: bold;
                        background: #f5f5f5;
                    }
                    
                    tfoot td {
                        padding: 15px 12px;
                        font-size: 1.2em;
                        border-top: 2px solid #c41e3a;
                    }
                    
                    .facture-footer {
                        text-align: center;
                        margin-top: 50px;
                        padding-top: 20px;
                        border-top: 1px solid #ddd;
                        color: #666;
                        font-size: 0.9em;
                    }
                    
                    .no-print {
                        text-align: center;
                        margin: 20px 0;
                    }
                    
                    .no-print button {
                        background: #c41e3a;
                        color: white;
                        border: none;
                        padding: 12px 30px;
                        font-size: 1em;
                        border-radius: 5px;
                        cursor: pointer;
                    }
                    
                    .no-print button:hover {
                        background: #a01629;
                    }
                    
                    @media print {
                        .no-print { display: none; }
                    }
                    
                    .paid-stamp-print {
                        position: absolute;
                        top: 120px;
                        right: 50px;
                        border: 4px solid #e74c3c;
                        color: #e74c3c;
                        font-size: 2rem;
                        font-weight: 900;
                        letter-spacing: 8px;
                        padding: 10px 35px;
                        text-transform: uppercase;
                        opacity: 0.6;
                        border-radius: 4px;
                        transform: rotate(-15deg);
                        pointer-events: none;
                        z-index: 100;
                    }
                    
                    .paid-stamp-print.manual {
                        border-color: #9b59b6;
                        color: #9b59b6;
                    }
                    .paid-stamp-print.creance {
                        border-color: #dc3545;
                        color: #dc3545;
                        font-size: 1.5rem;
                        padding: 8px 25px;
                    }
                </style>
            </head>
            <body style="position: relative;">
                ${(paymentStatus === 'P' || paymentStatus === 'M' || paymentStatus === 'C') ? 
                    `<div class="paid-stamp-print ${paymentStatus === 'M' ? 'manual' : (paymentStatus === 'C' ? 'creance' : '')}">
                        ${paymentStatus === 'C' ? `CRÉANCE (${formatCurrency(montantRestantDu)})` : 'PAYÉ'}
                    </div>` 
                    : ''
                }
                <div class="facture-header">
                    <h1>${config ? config.nom_complet : ''}</h1>
                    <div class="website">${config && config.site_web ? config.site_web : ''}</div>
                    ${config && config.slogan ? `<div class="slogan" style="font-size: 0.9em; color: #666; font-style: italic; margin-top: 5px;">${config.slogan}</div>` : ''}
                </div>
                
                <div class="facture-info">
                    <div class="info-section">
                        <h3>Point de vente</h3>
                        <p><strong>${pointVente}</strong></p>
                        <p>Date: ${dateCommande}</p>
                        <p>Heure: ${heureCommande}</p>
                    </div>
                    
                    <div class="info-section">
                        <h3>Facture N°</h3>
                        <p><strong>${commandeId}</strong></p>
                        ${clientName ? `
                            <h3 style="margin-top: 20px;">Client</h3>
                            <p>${clientName}</p>
                            ${clientPhone ? `<p>Tél: ${clientPhone}</p>` : ''}
                            ${clientAddress ? `<p>${clientAddress}</p>` : ''}
                        ` : ''}
                    </div>
                </div>
                
                <table>
                    <thead>
                        <tr>
                            <th>Produit</th>
                            <th class="text-center">Quantité</th>
                            <th class="text-right">Prix Unitaire</th>
                            <th class="text-right">Total</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${itemsRows}
                    </tbody>
                    <tfoot>
                        ${hasValidCredit ? `
                        <tr>
                            <td colspan="3" class="text-right">Sous-total</td>
                            <td class="text-right">${formatCurrency(commande.totalAmount)}</td>
                        </tr>
                        <tr style="color: #4CAF50;">
                            <td colspan="3" class="text-right">🎁 Crédit appliqué</td>
                            <td class="text-right">-${formatCurrency(creditUsed)}</td>
                        </tr>
                        <tr style="border-top: 2px solid #c41e3a;">
                            <td colspan="3" class="text-right">MONTANT À PAYER</td>
                            <td class="text-right">${formatCurrency(finalAmount)}</td>
                        </tr>
                        ` : `
                        <tr>
                            <td colspan="3" class="text-right">TOTAL À PAYER</td>
                            <td class="text-right">${formatCurrency(commande.totalAmount)}</td>
                        </tr>
                        `}
                        ${paymentStatus === 'C' ? `
                        <tr style="color: #dc3545; font-weight: bold;">
                            <td colspan="3" class="text-right">Déjà payé</td>
                            <td class="text-right">${formatCurrency(commande.totalAmount - montantRestantDu)}</td>
                        </tr>
                        <tr style="color: #dc3545; font-weight: bold; border-top: 2px solid #dc3545;">
                            <td colspan="3" class="text-right">RESTE À PAYER (CRÉANCE)</td>
                            <td class="text-right">${formatCurrency(montantRestantDu)}</td>
                        </tr>
                        ` : ''}
                    </tfoot>
                </table>
                
                <div class="facture-footer">
                    <p>${config && config.footer_facture ? config.footer_facture : 'Merci de votre confiance !'}</p>
                    <p><strong>${config ? config.nom_complet : ''}</strong>${config && config.site_web ? ' - ' + config.site_web : ''}</p>
                </div>
                
                <div class="no-print">
                    <button onclick="window.print()">🖨️ Imprimer</button>
                    <button onclick="window.close()" style="background: #666; margin-left: 10px;">Fermer</button>
                </div>
            </body>
            </html>
        `;
        
        // Open print window
        const printWindow = window.open('', '_blank', 'width=800,height=600');
        printWindow.document.write(factureHTML);
        printWindow.document.close();
        
        // Auto-print after load
        printWindow.onload = function() {
            setTimeout(() => {
                printWindow.print();
            }, 250);
        };
    }
}

// ========================================
// FONCTION D'IMPRESSION THERMIQUE
// ========================================
function imprimerTicketThermique(commandeId) {
    // Fermer le modal de commande d'abord
    const modalCommande = document.getElementById('modalDetailsCommande');
    if (modalCommande) {
        modalCommande.style.display = 'none';
    }
    
    const commande = commandesData.get(commandeId);
    if (!commande) {
        showToast('Commande introuvable', 'error');
        return;
    }
    
    // Get client info
    const firstItem = commande.items[0] || {};
    const clientName = firstItem.nomClient || firstItem['Client Name'] || '';
    const clientPhone = firstItem.numeroClient || firstItem['Client Phone'] || '';
    const clientAddress = firstItem.adresseClient || firstItem['Client Address'] || '';
    const clientInstructions = firstItem.instructionsClient || firstItem['Client Instructions'] || '';
    
    // Configuration du ticket (32 caractères de large pour imprimante 58mm)
    const LARGEUR = 32;
    const SEPARATEUR = '='.repeat(LARGEUR);
    const LIGNE = '-'.repeat(LARGEUR);
    
    // Fonction helper pour centrer le texte
    const centrer = (texte) => {
        const espaces = Math.max(0, Math.floor((LARGEUR - texte.length) / 2));
        return ' '.repeat(espaces) + texte;
    };
    
    // Fonction helper pour aligner à droite
    const alignerDroite = (texte) => {
        return ' '.repeat(Math.max(0, LARGEUR - texte.length)) + texte;
    };
    
    // Fonction pour formater une ligne produit (58mm = 32 car)
    const formatLigneProduit = (produit, qte, pu, total) => {
        // Pour 32 caractères : Produit(15) Qte(2) Total(15)
        // On simplifie pour 58mm : pas de prix unitaire
        let ligneProduit = produit.substring(0, 15).padEnd(15);
        // Quantité (2 char)
        ligneProduit += String(qte).padStart(2) + ' ';
        // Total (14 char)
        ligneProduit += String(total).padStart(14);
        return ligneProduit;
    };
    
    // Construction du ticket
    let ticket = '';
    
    // Get brand config (pass commandeId to detect brand)
    const config = typeof getBrandConfig === 'function' ? getBrandConfig(commandeId) : null;
    
    // En-tête
    ticket += SEPARATEUR + '\n';
    ticket += centrer(config ? config.nom_complet : '') + '\n';
    if (config && config.site_web) {
        ticket += centrer(config.site_web) + '\n';
    }
    ticket += '\n';
    
    // Téléphones - use config if available
    if (config && config.telephones && config.telephones.length > 0) {
        config.telephones.forEach(tel => {
            // Formater le numéro : enlever +221 et espaces, puis reformater
            let numero = tel.numero.replace(/\+221\s*/g, '').replace(/\s+/g, '');
            // Format: XX XXX XX XX (standard sénégalais)
            if (numero.length === 9) {
                numero = numero.substring(0, 2) + ' ' + numero.substring(2, 5) + ' ' + numero.substring(5, 7) + ' ' + numero.substring(7, 9);
            }
            const telLine = tel.point_vente ? `${tel.point_vente} ${numero}` : numero;
            ticket += centrer(telLine) + '\n';
        });
    } else {
        // Fallback
        ticket += centrer('O.Foire 78 480 95 95') + '\n';
        ticket += centrer('Mbao 77 858 96 96') + '\n';
        ticket += centrer('Keur Massar 78 777 26 26') + '\n';
    }
    ticket += SEPARATEUR + '\n';
    ticket += '\n';
    
    // Numéro de commande et date
    ticket += 'COMMANDE: ' + commandeId + '\n';
    const now = new Date();
    const dateStr = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;
    const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    ticket += `DATE: ${dateStr} ${timeStr}\n`;
    ticket += '\n';
    
    // Informations client (si présentes)
    if (clientName || clientPhone || clientAddress || clientInstructions) {
        ticket += LIGNE + '\n';
        ticket += 'INFORMATIONS CLIENT\n';
        ticket += LIGNE + '\n';
        if (clientName) ticket += 'Nom: ' + clientName + '\n';
        if (clientPhone) ticket += 'Tel: ' + clientPhone + '\n';
        if (clientAddress) ticket += 'Adresse: ' + clientAddress + '\n';
        if (clientInstructions) {
            ticket += LIGNE + '\n';
            ticket += '*** INSTRUCTIONS ***\n';
            ticket += clientInstructions + '\n';
        }
        ticket += '\n';
    }
    
    // Articles
    ticket += LIGNE + '\n';
    ticket += 'ARTICLES\n';
    ticket += LIGNE + '\n';
    ticket += formatLigneProduit('Produit', 'Qte', '', 'Total') + '\n';
    ticket += LIGNE + '\n';
    
    commande.items.forEach(item => {
        const nombre = item.Nombre || item.nombre || 1;
        const produit = item.Produit || item.produit || 'Produit';
        const prixUnit = item.PU || item.prixUnit || 0;
        const montant = item.Montant || item.montant || 0;
        
        ticket += formatLigneProduit(
            produit,
            nombre,
            '', // Pas de PU pour 58mm
            formatCurrency(montant)
        ) + '\n';
    });
    
    // Total
    ticket += '\n';
    ticket += SEPARATEUR + '\n';
    const totalStr = 'TOTAL' + formatCurrency(commande.totalAmount).padStart(LARGEUR - 5);
    ticket += totalStr + '\n';
    ticket += SEPARATEUR + '\n';
    ticket += '\n';
    
    // Statut de paiement (si payé)
    const paymentStatus = window.currentCommandePaymentStatus;
    if (paymentStatus === 'P' || paymentStatus === 'M') {
        const paymentLabel = paymentStatus === 'M' ? '*** PAYE (CASH/MANUEL) ***' : '*** PAYE ***';
        ticket += centrer(paymentLabel) + '\n';
        ticket += '\n';
    }
    
    // Footer - use config if available
    if (config && config.footer_facture) {
        ticket += centrer(config.footer_facture) + '\n';
    } else {
        ticket += centrer('Merci de votre confiance!') + '\n';
    }
    if (config && config.slogan) {
        ticket += centrer(config.slogan) + '\n';
    } else {
        ticket += centrer('Bon appetit!') + '\n';
    }
    ticket += SEPARATEUR;
    // No trailing newlines to minimize bottom whitespace
    
    // Partage direct via navigator.share (plus rapide)
    if (navigator.share) {
        navigator.share({
            title: `Ticket - ${commandeId}`,
            text: ticket
        }).then(() => {
            console.log('Ticket partagé avec succès');
        }).catch((error) => {
            // Si annulé ou erreur, ouvrir le modal avec options
            console.log('Partage annulé, ouverture modal:', error);
            ouvrirModalPartageTicket(ticket, commandeId);
        });
    } else {
        // Desktop ou navigateur sans support : ouvrir le modal
        ouvrirModalPartageTicket(ticket, commandeId);
    }
}

/**
 * Ouvre un modal de partage avec plusieurs options
 */
function ouvrirModalPartageTicket(ticket, commandeId) {
    // Encoder le ticket pour les URLs
    const ticketEncoded = encodeURIComponent(ticket);
    
    // Créer le modal avec aperçu
    const modalHTML = `
        <div id="modalPartageTicket" style="
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,0.7);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10000;
        ">
            <div style="
                background: white;
                border-radius: 12px;
                padding: 25px;
                max-width: 600px;
                width: 90%;
                max-height: 90vh;
                overflow-y: auto;
            ">
                <h2 style="margin-top: 0; color: #333;">📤 Partager le ticket</h2>
                <p style="color: #666; margin-bottom: 15px;">Commande: ${commandeId}</p>
                
                <!-- Aperçu du ticket -->
                <div style="
                    background: #f5f5f5;
                    border-radius: 8px;
                    padding: 15px;
                    margin-bottom: 20px;
                    max-height: 200px;
                    overflow-y: auto;
                    font-family: 'Courier New', monospace;
                    font-size: 11px;
                    white-space: pre;
                    line-height: 1.4;
                ">${ticket}</div>
                
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                    <!-- WhatsApp -->
                    <button onclick="partagerWhatsApp('${ticketEncoded}')" style="
                        padding: 12px;
                        background: #25D366;
                        color: white;
                        border: none;
                        border-radius: 8px;
                        cursor: pointer;
                        font-size: 14px;
                        display: flex;
                        flex-direction: column;
                        align-items: center;
                        gap: 5px;
                    ">
                        <span style="font-size: 28px;">💬</span>
                        WhatsApp
                    </button>
                    
                    <!-- RawBT Printer (Samsung A9) -->
                    <button onclick="partagerRawBT('${ticketEncoded}')" style="
                        padding: 12px;
                        background: #FF6B35;
                        color: white;
                        border: none;
                        border-radius: 8px;
                        cursor: pointer;
                        font-size: 14px;
                        display: flex;
                        flex-direction: column;
                        align-items: center;
                        gap: 5px;
                    ">
                        <span style="font-size: 28px;">🖨️</span>
                        RawBT
                    </button>
                    
                    <!-- Email -->
                    <button onclick="partagerEmail('${ticketEncoded}', '${commandeId}')" style="
                        padding: 12px;
                        background: #EA4335;
                        color: white;
                        border: none;
                        border-radius: 8px;
                        cursor: pointer;
                        font-size: 14px;
                        display: flex;
                        flex-direction: column;
                        align-items: center;
                        gap: 5px;
                    ">
                        <span style="font-size: 28px;">📧</span>
                        Email
                    </button>
                    
                    <!-- SMS -->
                    <button onclick="partagerSMS('${ticketEncoded}')" style="
                        padding: 12px;
                        background: #34B7F1;
                        color: white;
                        border: none;
                        border-radius: 8px;
                        cursor: pointer;
                        font-size: 14px;
                        display: flex;
                        flex-direction: column;
                        align-items: center;
                        gap: 5px;
                    ">
                        <span style="font-size: 28px;">💬</span>
                        SMS
                    </button>
                    
                    <!-- Copier -->
                    <button onclick="copierTicket(\`${ticket.replace(/`/g, '\\`').replace(/\$/g, '\\$')}\`)" style="
                        padding: 12px;
                        background: #5865F2;
                        color: white;
                        border: none;
                        border-radius: 8px;
                        cursor: pointer;
                        font-size: 14px;
                        display: flex;
                        flex-direction: column;
                        align-items: center;
                        gap: 5px;
                    ">
                        <span style="font-size: 28px;">📋</span>
                        Copier
                    </button>
                    
                    <!-- Imprimer -->
                    <button onclick="fermerModalPartage(); imprimerTicketClassique(\`${ticket.replace(/`/g, '\\`').replace(/\$/g, '\\$')}\`, '${commandeId}')" style="
                        padding: 12px;
                        background: #4CAF50;
                        color: white;
                        border: none;
                        border-radius: 8px;
                        cursor: pointer;
                        font-size: 14px;
                        display: flex;
                        flex-direction: column;
                        align-items: center;
                        gap: 5px;
                    ">
                        <span style="font-size: 28px;">🖨️</span>
                        Imprimer
                    </button>
                </div>
                
                <button onclick="fermerModalPartage()" style="
                    margin-top: 15px;
                    padding: 10px;
                    background: #666;
                    color: white;
                    border: none;
                    border-radius: 8px;
                    cursor: pointer;
                    width: 100%;
                    font-size: 14px;
                ">
                    Annuler
                </button>
            </div>
        </div>
    `;
    
    // Ajouter le modal au body
    const modalDiv = document.createElement('div');
    modalDiv.innerHTML = modalHTML;
    document.body.appendChild(modalDiv.firstElementChild);
}

/**
 * Partager via WhatsApp
 */
function partagerWhatsApp(ticketEncoded) {
    const text = decodeURIComponent(ticketEncoded);
    const url = `https://wa.me/?text=${encodeURIComponent(text)}`;
    window.open(url, '_blank');
    fermerModalPartage();
}

/**
 * Partager via RawBT (imprimante Bluetooth Samsung A9)
 */
async function partagerRawBT(ticketEncoded) {
    const text = decodeURIComponent(ticketEncoded);
    
    // Utiliser navigator.share pour que RawBT apparaisse dans les options
    if (navigator.share) {
        try {
            await navigator.share({
                title: 'Ticket',
                text: text
            });
            fermerModalPartage();
        } catch (error) {
            console.log('Partage annulé ou erreur:', error);
            // Si l'utilisateur annule, on ne fait rien
        }
    } else {
        // Fallback : copier dans le presse-papier
        try {
            await navigator.clipboard.writeText(text);
            showToast('Ticket copié ! Ouvrez RawBT manuellement.', 'info');
            fermerModalPartage();
        } catch (error) {
            showToast('Impossible de partager. Utilisez le bouton Copier.', 'error');
        }
    }
}

/**
 * Partager via Email
 */
function partagerEmail(ticketEncoded, commandeId) {
    const text = decodeURIComponent(ticketEncoded);
    const subject = `Ticket - ${commandeId}`;
    const url = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`;
    window.location.href = url;
    fermerModalPartage();
}

/**
 * Partager via SMS
 */
function partagerSMS(ticketEncoded) {
    const text = decodeURIComponent(ticketEncoded);
    const url = `sms:?body=${encodeURIComponent(text)}`;
    window.location.href = url;
    fermerModalPartage();
}

/**
 * Copier le ticket dans le presse-papier
 */
async function copierTicket(ticket) {
    try {
        await navigator.clipboard.writeText(ticket);
        showToast('Ticket copié dans le presse-papier !', 'success');
        fermerModalPartage();
    } catch (error) {
        console.error('Erreur copie:', error);
        showToast('Erreur lors de la copie', 'error');
    }
}

/**
 * Partage natif (fallback vers le menu système)
 */
async function partagerNatif(ticketEncoded, commandeId) {
    const text = decodeURIComponent(ticketEncoded);
    try {
        await navigator.share({
            title: `Ticket - ${commandeId}`,
            text: text
        });
        fermerModalPartage();
    } catch (error) {
        console.log('Partage annulé ou erreur:', error);
    }
}

/**
 * Fermer le modal de partage
 */
function fermerModalPartage() {
    const modal = document.getElementById('modalPartageTicket');
    if (modal) {
        modal.remove();
    }
}

/**
 * Impression classique via fenêtre popup (fallback desktop)
 */
function imprimerTicketClassique(ticket, commandeId) {
    const printWindow = window.open('', '_blank', 'width=400,height=600');
    if (!printWindow) {
        showToast('Impossible d\'ouvrir la fenêtre d\'impression. Vérifiez les popups bloqués.', 'error');
        return;
    }
    
    printWindow.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Ticket - ${commandeId}</title>
            <meta charset="utf-8">
            <style>
                body {
                    font-family: 'Courier New', monospace;
                    font-size: 12px;
                    margin: 0;
                    padding: 10px;
                    white-space: pre;
                    line-height: 1.3;
                }
                @media print {
                    @page {
                        margin: 0;
                        size: auto;
                    }
                    body {
                        margin: 0;
                        padding: 0;
                    }
                    html {
                        margin: 0;
                        padding: 0;
                    }
                    .no-print {
                        display: none;
                    }
                }
                .no-print {
                    margin-top: 20px;
                    text-align: center;
                }
                .no-print button {
                    padding: 10px 20px;
                    font-size: 14px;
                    cursor: pointer;
                    background: #4CAF50;
                    color: white;
                    border: none;
                    border-radius: 4px;
                    margin: 5px;
                }
                .no-print button:hover {
                    background: #45a049;
                }
                .no-print button.secondary {
                    background: #666;
                }
                .no-print button.usb {
                    background: #2196F3;
                }
                .no-print button.bluetooth {
                    background: #9C27B0;
                }
            </style>
        </head>
        <body>${ticket}<div class="no-print">
                <button onclick="window.print()">🖨️ Imprimer</button>
                <button class="usb" onclick="imprimerUSB()">🔌 Imprimante USB</button>
                <button class="bluetooth" onclick="imprimerBluetooth()">📡 Bluetooth</button>
                <button class="secondary" onclick="window.close()">Fermer</button>
            </div>
            <script>
                // Fonction pour imprimer via USB
                async function imprimerUSB() {
                    try {
                        if (!navigator.usb) {
                            alert('WebUSB n\\'est pas supporté par votre navigateur. Utilisez Chrome ou Edge.');
                            return;
                        }
                        
                        // Demander l'accès à un périphérique USB
                        const device = await navigator.usb.requestDevice({ filters: [] });
                        alert('Périphérique USB sélectionné: ' + device.productName);
                        
                        // Ouvrir la connexion
                        await device.open();
                        await device.selectConfiguration(1);
                        await device.claimInterface(0);
                        
                        // Convertir le texte en commandes ESC/POS
                        const encoder = new TextEncoder();
                        const ticketText = document.body.textContent.split('🖨️')[0];
                        const data = encoder.encode(ticketText + '\\n\\n\\n\\n');
                        
                        // Envoyer les données à l'imprimante
                        await device.transferOut(1, data);
                        
                        // Fermer la connexion
                        await device.close();
                        
                        alert('Impression USB réussie!');
                        window.close();
                    } catch (error) {
                        console.error('Erreur USB:', error);
                        alert('Erreur d\\'impression USB: ' + error.message);
                    }
                }
                
                // Fonction pour imprimer via Bluetooth
                async function imprimerBluetooth() {
                    try {
                        if (!navigator.bluetooth) {
                            alert('Bluetooth n\\'est pas supporté par votre navigateur. Utilisez Chrome ou Edge.');
                            return;
                        }
                        
                        // Rechercher un périphérique Bluetooth
                        const device = await navigator.bluetooth.requestDevice({
                            acceptAllDevices: true,
                            optionalServices: ['000018f0-0000-1000-8000-00805f9b34fb']
                        });
                        
                        alert('Périphérique Bluetooth sélectionné: ' + device.name);
                        
                        // Se connecter au périphérique
                        const server = await device.gatt.connect();
                        
                        // Récupérer le service d'impression
                        const service = await server.getPrimaryService('000018f0-0000-1000-8000-00805f9b34fb');
                        const characteristic = await service.getCharacteristic('00002af1-0000-1000-8000-00805f9b34fb');
                        
                        // Envoyer les données
                        const encoder = new TextEncoder();
                        const ticketText = document.body.textContent.split('🖨️')[0];
                        const data = encoder.encode(ticketText + '\\n\\n\\n\\n');
                        
                        await characteristic.writeValue(data);
                        
                        alert('Impression Bluetooth réussie!');
                        window.close();
                    } catch (error) {
                        console.error('Erreur Bluetooth:', error);
                        alert('Erreur d\\'impression Bluetooth: ' + error.message + '\\n\\nVérifiez que l\\'imprimante est allumée et appairée.');
                    }
                }
            </script>
        </body>
        </html>
    `);
    printWindow.document.close();
}

/**
 * Lister les périphériques USB disponibles
 */
async function listerPeripheriquesUSB() {
    if (!navigator.usb) {
        showToast('WebUSB n\'est pas supporté. Utilisez Chrome ou Edge.', 'error');
        return [];
    }
    
    try {
        const devices = await navigator.usb.getDevices();
        console.log('📱 Périphériques USB trouvés:', devices);
        
        devices.forEach((device, index) => {
            console.log(`  ${index + 1}. ${device.productName || 'Périphérique inconnu'}`);
            console.log(`     Fabricant: ${device.manufacturerName || 'N/A'}`);
            console.log(`     Vendor ID: ${device.vendorId}, Product ID: ${device.productId}`);
        });
        
        return devices;
    } catch (error) {
        console.error('Erreur lors de la liste des périphériques USB:', error);
        return [];
    }
}

/**
 * Lister les périphériques Bluetooth disponibles
 */
async function listerPeripheriquesBluetooth() {
    if (!navigator.bluetooth) {
        showToast('Bluetooth n\'est pas supporté. Utilisez Chrome ou Edge.', 'error');
        return [];
    }
    
    try {
        // Note: Bluetooth nécessite une interaction utilisateur
        const device = await navigator.bluetooth.requestDevice({
            acceptAllDevices: true,
            optionalServices: ['000018f0-0000-1000-8000-00805f9b34fb']
        });
        
        console.log('📡 Périphérique Bluetooth sélectionné:', device.name);
        return [device];
    } catch (error) {
        console.error('Erreur lors de la recherche Bluetooth:', error);
        return [];
    }
}

function fermerModalDetailsCommande() {

}

// ========================================
// FONCTIONS GESTION BICTORYS
// ========================================
function generateBictorysSection(commandeId, totalAmount, bictorysLink) {
    if (!bictorysLink) {
        return `
            <div class="bictorys-section" style="margin-top: 20px; padding: 15px; background: #f8f9fa; border-radius: 8px;">
                <h4><i class="fas fa-credit-card"></i> Lien de paiement Bictorys</h4>
                <p style="color: #6c757d; margin-bottom: 10px;">Aucun lien de paiement généré pour cette commande.</p>
                <div style="display: flex; gap: 10px; align-items: center;">
                    <input type="number" id="bictorysAmountModal" 
                        value="${totalAmount}" 
                        placeholder="Montant"
                        style="flex: 1; padding: 10px; border: 1px solid #ddd; border-radius: 4px;">
                    <button onclick="genererLienBictorys('${commandeId}')" 
                        class="btn-generate-bictorys"
                        style="padding: 10px 20px; background: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer;">
                        <i class="fas fa-plus"></i> Générer le lien
                    </button>
                </div>
            </div>
        `;
    }
    
    if (bictorysLink.exists) {
        return `
            <div class="bictorys-section" style="margin-top: 20px; padding: 15px; background: #e7f3ff; border-radius: 8px; border-left: 4px solid #007bff;">
                <h4><i class="fas fa-credit-card"></i> Lien de paiement Bictorys</h4>
                <div style="margin: 10px 0;">
                    <p style="margin-bottom: 5px;"><strong>Statut:</strong> <span style="color: #28a745;">${bictorysLink.status || 'actif'}</span></p>
                    <p style="margin-bottom: 5px;"><strong>Montant:</strong> ${formatCurrency(bictorysLink.amount)}</p>
                    ${bictorysLink.generatedAt ? `<p style="margin-bottom: 5px; font-size: 0.9em; color: #6c757d;"><strong>Généré le:</strong> ${new Date(bictorysLink.generatedAt).toLocaleString('fr-FR')}</p>` : ''}
                </div>
                <div style="background: white; padding: 10px; border-radius: 4px; margin: 10px 0; display: flex; align-items: center; gap: 10px;">
                    <input type="text" 
                        value="${bictorysLink.url}" 
                        readonly 
                        id="bictorysUrlDisplay"
                        style="flex: 1; padding: 8px; border: 1px solid #ddd; border-radius: 4px; font-size: 0.9em; color: #495057;">
                    <button onclick="copierLienBictorys('${bictorysLink.url}')" 
                        title="Copier le lien"
                        style="padding: 8px 12px; background: #6c757d; color: white; border: none; border-radius: 4px; cursor: pointer;">
                        <i class="fas fa-copy"></i>
                    </button>
                    <a href="${bictorysLink.url}" 
                        target="_blank" 
                        title="Voir le lien"
                        style="padding: 8px 12px; background: #17a2b8; color: white; border: none; border-radius: 4px; text-decoration: none; display: inline-block;">
                        <i class="fas fa-eye"></i>
                    </a>
                </div>
                <div style="display: flex; gap: 10px; margin-top: 10px;">
                    <div style="flex: 1;">
                        <input type="number" id="bictorysAmountModal" 
                            value="${bictorysLink.amount}" 
                            placeholder="Nouveau montant"
                            style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px;">
                    </div>
                    <button onclick="regenererLienBictorys('${commandeId}')" 
                        class="btn-regenerate-bictorys"
                        style="padding: 8px 16px; background: #ffc107; color: #000; border: none; border-radius: 4px; cursor: pointer; white-space: nowrap;">
                        <i class="fas fa-sync-alt"></i> Régénérer
                    </button>
                    <button onclick="supprimerLienBictorys('${commandeId}')" 
                        class="btn-delete-bictorys"
                        style="padding: 8px 16px; background: #dc3545; color: white; border: none; border-radius: 4px; cursor: pointer;">
                        <i class="fas fa-trash"></i> Supprimer
                    </button>
                </div>
            </div>
        `;
    }
    
    return '';
}

async function genererLienBictorys(commandeId) {
    const amount = parseFloat(document.getElementById('bictorysAmountModal').value);
    
    if (!amount || amount <= 0) {
        showToast('Veuillez entrer un montant valide', 'error');
        return;
    }
    
    try {
        showToast('Génération du lien Bictorys...', 'info');
        
        const response = await fetch(`/api/orders/${commandeId}/bictorys-link`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
                amount: amount,
                regenerate: false
            })
        });
        
        const result = await response.json();
        
        if (result.success) {
            showToast('✅ Lien Bictorys généré avec succès !', 'success');
            // Recharger le modal pour afficher le nouveau lien
            fermerModalDetailsCommande();
            setTimeout(() => afficherDetailsCommande(commandeId), 300);
        } else {
            showToast('❌ ' + (result.message || 'Erreur lors de la génération'), 'error');
        }
    } catch (error) {
        console.error('Erreur génération lien:', error);
        showToast('❌ Erreur lors de la génération du lien', 'error');
    }
}

async function regenererLienBictorys(commandeId) {
    const amount = parseFloat(document.getElementById('bictorysAmountModal').value);
    
    if (!amount || amount <= 0) {
        showToast('Veuillez entrer un montant valide', 'error');
        return;
    }
    
    if (!confirm('Voulez-vous vraiment régénérer le lien de paiement Bictorys ?')) {
        return;
    }
    
    try {
        showToast('Régénération du lien Bictorys...', 'info');
        
        const response = await fetch(`/api/orders/${commandeId}/bictorys-link`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
                amount: amount,
                regenerate: true
            })
        });
        
        const result = await response.json();
        
        if (result.success) {
            showToast('🔄 Lien Bictorys régénéré avec succès !', 'success');
            // Recharger le modal
            fermerModalDetailsCommande();
            setTimeout(() => afficherDetailsCommande(commandeId), 300);
        } else {
            showToast('❌ ' + (result.message || 'Erreur lors de la régénération'), 'error');
        }
    } catch (error) {
        console.error('Erreur régénération lien:', error);
        showToast('❌ Erreur lors de la régénération du lien', 'error');
    }
}

async function supprimerLienBictorys(commandeId) {
    if (!confirm('Voulez-vous vraiment supprimer le lien de paiement Bictorys ?')) {
        return;
    }
    
    try {
        showToast('Suppression du lien Bictorys...', 'info');
        
        const response = await fetch(`/api/orders/${commandeId}/bictorys-link`, {
            method: 'DELETE',
            credentials: 'include'
        });
        
        const result = await response.json();
        
        if (result.success) {
            showToast('🗑️ Lien Bictorys supprimé avec succès !', 'success');
            // Recharger le modal
            fermerModalDetailsCommande();
            setTimeout(() => afficherDetailsCommande(commandeId), 300);
        } else {
            showToast('❌ ' + (result.message || 'Erreur lors de la suppression'), 'error');
        }
    } catch (error) {
        console.error('Erreur suppression lien:', error);
        showToast('❌ Erreur lors de la suppression du lien', 'error');
    }
}

function copierLienBictorys(url) {
    navigator.clipboard.writeText(url).then(() => {
        showToast('📋 Lien copié dans le presse-papier !', 'success');
    }).catch(err => {
        console.error('Erreur copie:', err);
        showToast('❌ Erreur lors de la copie', 'error');
    });
}

function fermerModalDetailsCommande() {
    document.getElementById('modalDetailsCommande').classList.remove('active');
}

// ========================================
// FONCTION D'ENVOI WHATSAPP
// ========================================
async function envoyerFactureWhatsApp(commandeId) {
    console.log('🟢 [WHATSAPP] Fonction envoyerFactureWhatsApp appelée pour:', commandeId);
    
    const commande = commandesData.get(commandeId);
    if (!commande) {
        showToast('Commande introuvable', 'error');
        return;
    }
    
    // Get client info
    const firstItem = commande.items[0] || {};
    const clientName = firstItem.nomClient || firstItem['Client Name'] || '';
    const clientPhone = firstItem.numeroClient || firstItem['Client Phone'] || '';
    
    // Vérifier si le client a un numéro de téléphone
    if (!clientPhone) {
        showToast('Aucun numéro de téléphone pour ce client', 'warning');
        return;
    }
    
    // Nettoyer le numéro de téléphone (enlever les espaces, +, points, etc.)
    // Le format doit être 33612345678 (sans le +)
    const telNettoye = clientPhone.replace(/\D/g, '');
    
    if (telNettoye.length < 8) {
        showToast('Numéro de téléphone invalide', 'error');
        return;
    }
    
    // Get point de vente
    const pointVente = document.getElementById('pointVenteSelect')?.value || 'Point de vente';
    
    // Get date
    const dateCommande = firstItem.Date || firstItem.date || new Date().toLocaleDateString('fr-FR');
    const heureCommande = commande.createdAt ? new Date(commande.createdAt).toLocaleTimeString('fr-FR', {
        hour: '2-digit',
        minute: '2-digit'
    }) : '';
    
    // Générer d'abord le PDF (comme pour l'impression)
    showToast('Génération du PDF en cours...', 'info');
    
    // Build items rows pour le PDF
    const itemsRows = commande.items.map(item => {
        const nombre = item.Nombre || item.nombre || 1;
        const produit = item.Produit || item.produit || 'Produit';
        const prixUnit = item.PU || item.prixUnit || 0;
        const montant = item.Montant || item.montant || 0;
        
        return `
            <tr>
                <td>${produit}</td>
                <td class="text-center">${nombre}</td>
                <td class="text-right">${formatCurrency(prixUnit)}</td>
                <td class="text-right">${formatCurrency(montant)}</td>
            </tr>
        `;
    }).join('');
    
    // Vérifier si un lien Bictorys existe déjà pour cette commande
    let paymentLinkUrl = null;
    
    try {
        console.log('🔍 [CLIENT] Vérification lien Bictorys existant pour:', commandeId);
        
        // Récupérer les détails de la commande avec le lien Bictorys
        const detailsResponse = await fetch(`/api/orders/${commandeId}/details`, {
            method: 'GET',
            credentials: 'include'
        });
        
        if (detailsResponse.ok) {
            const detailsResult = await detailsResponse.json();
            if (detailsResult.success && detailsResult.data?.bictorysLink?.exists) {
                paymentLinkUrl = detailsResult.data.bictorysLink.url;
                console.log('✅ Lien Bictorys existant trouvé:', paymentLinkUrl);
            } else {
                console.log('ℹ️ Aucun lien Bictorys pour cette commande');
            }
        } else {
            console.warn('⚠️ Erreur récupération détails commande');
        }
        
    } catch (error) {
        console.warn('⚠️ Erreur vérification lien Bictorys:', error.message);
        // Continue sans le lien - pas bloquant
    }
    
    // Construire le message WhatsApp (avec ou sans lien de paiement)
    console.log('🔵 [WHATSAPP] Début construction message pour commande:', commandeId);
    let message = `Bonjour ${clientName || 'Client'},\n\n`;
    message += `Voici les détails de votre commande n°${commandeId} :\n\n`;
    message += `📅 Date: ${dateCommande} ${heureCommande}\n`;
    message += `🏪 Point de vente: ${pointVente}\n\n`;
    message += `📦 Articles :\n`;
    
    // Ajouter chaque article
    commande.items.forEach((item, index) => {
        const nombre = item.Nombre || item.nombre || 1;
        const produit = item.Produit || item.produit || 'Produit';
        const prixUnit = item.PU || item.prixUnit || 0;
        const montant = item.Montant || item.montant || 0;
        
        message += `${index + 1}. ${produit}\n`;
        message += `   Quantité: ${nombre}\n`;
        message += `   Prix unitaire: ${formatCurrency(prixUnit)}\n`;
        message += `   Total: ${formatCurrency(montant)}\n\n`;
    });
    
    message += ` TOTAL: ${formatCurrency(commande.totalAmount)}\n\n`;
    console.log('🔵 [WHATSAPP] Message de base construit, longueur:', message.length);
    
    console.log('🔵 [WHATSAPP] Message final avant footer, longueur:', message.length);
    
    // Ajouter le lien de paiement s'il a été généré
    if (paymentLinkUrl) {
        console.log('💳 [WHATSAPP] Ajout lien de paiement:', paymentLinkUrl);
        message += `💳 Payer en ligne :\n${paymentLinkUrl}\n\n`;
    }
    
    // Get brand config from pos.js and use its footer (pass commandeId to detect brand)
    const config = typeof getBrandConfig === 'function' ? getBrandConfig(commandeId) : null;
    if (config && config.footer_whatsapp) {
        message += config.footer_whatsapp;
    } else {
        message += `Merci de votre confiance !`;
    }
    
    console.log('🔵 [WHATSAPP] Message final complet, longueur totale:', message.length);
    console.log('🔵 [WHATSAPP] Aperçu message (200 premiers caractères):', message.substring(0, 200));
    
    // Encoder le message pour l'URL
    const messageEncode = encodeURIComponent(message);
    
    // Construire l'URL WhatsApp
    const urlWhatsApp = `https://wa.me/${telNettoye}?text=${messageEncode}`;
    
    console.log('🔵 [WHATSAPP] Ouverture WhatsApp pour:', telNettoye);
    
    // Ouvrir dans un nouvel onglet/fenêtre
    window.open(urlWhatsApp, '_blank');
    
    showToast('Ouverture de WhatsApp...', 'success');
}

