// Global variables
let allPerformances = [];
let allAcheteurs = [];
let currentEditId = null;

// Initialize on page load
document.addEventListener('DOMContentLoaded', function() {
    console.log('DOM loaded');
    console.log('Flatpickr available:', typeof flatpickr !== 'undefined');
    
    // Delay initialization slightly to ensure all scripts are loaded
    setTimeout(() => {
        initializeDatePickers();
        loadAcheteurs();
        
        // Load performances with default date range (first day of month to today)
        const today = new Date();
        const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
        const defaultFilters = {
            startDate: firstDayOfMonth.toISOString().split('T')[0],
            endDate: today.toISOString().split('T')[0]
        };
        
        loadPerformances(defaultFilters);
        loadRankings();
        setupEventListeners();
    }, 100);
});

// Initialize Flatpickr date pickers
function initializeDatePickers() {
    console.log('Initializing date pickers...');
    
    if (typeof flatpickr === 'undefined') {
        console.error('Flatpickr not loaded!');
        return;
    }
    
    // Main form date picker
    const dateInput = document.getElementById('date');
    console.log('Date input found:', dateInput);
    
    if (dateInput) {
        const fp = flatpickr(dateInput, {
            dateFormat: 'Y-m-d',
            allowInput: false,
            defaultDate: new Date(),
            locale: window.flatpickr.l10ns.fr || 'fr',
            disableMobile: true,
            clickOpens: true,
            onChange: function(selectedDates, dateStr, instance) {
                console.log('Date selected:', dateStr);
            }
        });
        console.log('Flatpickr instance created:', fp);
    }

    // Filter start date - default to first day of current month
    const filterStartDate = document.getElementById('filter-start-date');
    if (filterStartDate) {
        const firstDayOfMonth = new Date();
        firstDayOfMonth.setDate(1); // Set to 1st day of current month
        
        flatpickr(filterStartDate, {
            dateFormat: 'Y-m-d',
            allowInput: false,
            defaultDate: firstDayOfMonth,
            locale: window.flatpickr.l10ns.fr || 'fr',
            disableMobile: true
        });
    }

    // Filter end date - default to today
    const filterEndDate = document.getElementById('filter-end-date');
    if (filterEndDate) {
        flatpickr(filterEndDate, {
            dateFormat: 'Y-m-d',
            allowInput: false,
            defaultDate: new Date(), // Today
            locale: window.flatpickr.l10ns.fr || 'fr',
            disableMobile: true
        });
    }
    
    console.log('Date pickers initialized');
}

// Setup event listeners
function setupEventListeners() {
    document.getElementById('performanceForm').addEventListener('submit', handleFormSubmit);
    document.getElementById('filterForm').addEventListener('submit', handleFilterSubmit);
    document.getElementById('cancelEdit').addEventListener('click', cancelEdit);
    document.getElementById('exportExcel').addEventListener('click', exportToExcel);
}

// Load acheteurs from API
async function loadAcheteurs() {
    try {
        console.log('Loading acheteurs...');
        const response = await fetch('/api/acheteurs', {
            credentials: 'include' // Include session cookies
        });
        console.log('Response status:', response.status);
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        console.log('Acheteurs data:', data);
        
        if (data.success) {
            allAcheteurs = data.acheteurs;
            console.log('Acheteurs loaded:', allAcheteurs);
            populateAcheteurDropdowns();
        } else {
            showNotification('Erreur lors du chargement des acheteurs: ' + (data.error || 'Unknown error'), 'danger');
        }
    } catch (error) {
        console.error('Error loading acheteurs:', error);
        showNotification('Erreur lors du chargement des acheteurs: ' + error.message, 'danger');
    }
}

// Populate acheteur dropdowns
function populateAcheteurDropdowns() {
    const acheteurSelect = document.getElementById('acheteur');
    const filterAcheteurSelect = document.getElementById('filter-acheteur');
    
    // Clear existing options (except first one)
    acheteurSelect.innerHTML = '<option value="">Sélectionner...</option>';
    filterAcheteurSelect.innerHTML = '<option value="">Tous</option>';
    
    allAcheteurs.forEach(acheteur => {
        const option = document.createElement('option');
        option.value = acheteur.id;
        option.textContent = `${acheteur.prenom} ${acheteur.nom}`;
        acheteurSelect.appendChild(option);
        
        const filterOption = option.cloneNode(true);
        filterAcheteurSelect.appendChild(filterOption);
    });
}

// Load performances from API
async function loadPerformances(filters = {}) {
    try {
        const params = new URLSearchParams();
        if (filters.startDate) params.append('startDate', filters.startDate);
        if (filters.endDate) params.append('endDate', filters.endDate);
        if (filters.idAcheteur) params.append('idAcheteur', filters.idAcheteur);
        if (filters.bete) params.append('bete', filters.bete);
        
        const response = await fetch(`/api/performance-achat?${params.toString()}`, {
            credentials: 'include' // Include session cookies
        });
        const data = await response.json();
        
        if (data.success) {
            allPerformances = data.performances;
            displayPerformances(allPerformances);
            updateQuickStats(allPerformances);
        } else {
            showNotification('Erreur lors du chargement des performances', 'danger');
        }
    } catch (error) {
        console.error('Error loading performances:', error);
        showNotification('Erreur lors du chargement des performances', 'danger');
    }
}

// Display performances in table
function displayPerformances(performances) {
    const tbody = document.getElementById('performanceTableBody');
    
    if (performances.length === 0) {
        tbody.innerHTML = '<tr><td colspan="10" class="text-center">Aucune donnée disponible</td></tr>';
        return;
    }
    
    tbody.innerHTML = '';
    
    performances.forEach(perf => {
        const row = document.createElement('tr');
        
        // Date
        const dateCell = document.createElement('td');
        dateCell.textContent = perf.date;
        row.appendChild(dateCell);
        
        // Acheteur
        const acheteurCell = document.createElement('td');
        acheteurCell.textContent = perf.acheteur_nom;
        row.appendChild(acheteurCell);
        
        // Type (Boeuf/Veau)
        const beteCell = document.createElement('td');
        beteCell.textContent = perf.bete.charAt(0).toUpperCase() + perf.bete.slice(1);
        row.appendChild(beteCell);
        
        // Poids Estimé avec timestamp et date visible
        const poidsEstimeCell = document.createElement('td');
        if (perf.poids_estime) {
            const timestampDate = perf.poids_estime_timestamp ? formatTimestampWithDate(perf.poids_estime_timestamp) : null;
            poidsEstimeCell.innerHTML = `
                <strong>${perf.poids_estime.toFixed(2)} kg</strong>
                ${timestampDate ? `<br><small class="text-muted"><i class="fas fa-clock"></i> ${timestampDate.time}<br>${timestampDate.date}</small>` : ''}
            `;
            if (perf.poids_estime_timestamp) {
                poidsEstimeCell.title = `Modifié par ${perf.poids_estime_updated_by || 'Unknown'}`;
            }
        } else {
            poidsEstimeCell.innerHTML = '<span class="text-muted">-</span>';
        }
        row.appendChild(poidsEstimeCell);
        
        // Poids Réel avec timestamp et date visible
        const poidsReelCell = document.createElement('td');
        if (perf.poids_reel) {
            const timestampDate = perf.poids_reel_timestamp ? formatTimestampWithDate(perf.poids_reel_timestamp) : null;
            poidsReelCell.innerHTML = `
                <strong>${perf.poids_reel.toFixed(2)} kg</strong>
                ${timestampDate ? `<br><small class="text-muted"><i class="fas fa-clock"></i> ${timestampDate.time}<br>${timestampDate.date}</small>` : ''}
            `;
            if (perf.poids_reel_timestamp) {
                poidsReelCell.title = `Modifié par ${perf.poids_reel_updated_by || 'Unknown'}`;
            }
        } else {
            poidsReelCell.innerHTML = '<span class="text-muted">-</span>';
        }
        row.appendChild(poidsReelCell);
        
        // Écart
        const ecartCell = document.createElement('td');
        if (perf.ecart !== null) {
            ecartCell.textContent = `${perf.ecart >= 0 ? '+' : ''}${perf.ecart.toFixed(2)} kg`;
            ecartCell.className = perf.ecart > 0 ? 'text-danger' : (perf.ecart < 0 ? 'text-info' : 'text-success');
        } else {
            ecartCell.innerHTML = '<span class="text-muted">-</span>';
        }
        row.appendChild(ecartCell);
        
        // Erreur (%) - anciennement Performance
        const erreurCell = document.createElement('td');
        if (perf.erreur !== null && perf.erreur !== undefined) {
            erreurCell.innerHTML = `<strong>${perf.erreur >= 0 ? '+' : ''}${perf.erreur.toFixed(2)}%</strong>`;
            erreurCell.className = perf.erreur > 0 ? 'text-danger' : (perf.erreur < 0 ? 'text-info' : 'text-success');
        } else {
            erreurCell.innerHTML = '<span class="text-muted">-</span>';
        }
        row.appendChild(erreurCell);
        
        // Précision (%)
        const precisionCell = document.createElement('td');
        if (perf.precision !== null && perf.precision !== undefined) {
            precisionCell.innerHTML = `<strong>${perf.precision.toFixed(2)}%</strong>`;
            // Color code: green for high precision, yellow for medium, red for low
            if (perf.precision >= 95) {
                precisionCell.className = 'text-success';
            } else if (perf.precision >= 90) {
                precisionCell.className = 'text-warning';
            } else {
                precisionCell.className = 'text-danger';
            }
        } else {
            precisionCell.innerHTML = '<span class="text-muted">-</span>';
        }
        row.appendChild(precisionCell);
        
        // Type d'estimation
        const typeEstimationCell = document.createElement('td');
        if (perf.type_estimation) {
            const badge = document.createElement('span');
            badge.className = 'badge';
            badge.textContent = perf.type_estimation;
            
            if (perf.type_estimation === 'Surestimation') {
                badge.classList.add('badge-surestimation');
            } else if (perf.type_estimation === 'Sous-estimation') {
                badge.classList.add('badge-sous-estimation');
            } else {
                badge.classList.add('badge-parfait');
            }
            
            typeEstimationCell.appendChild(badge);
        } else {
            typeEstimationCell.textContent = '-';
        }
        row.appendChild(typeEstimationCell);
        
        // Cohérence
        const coherenceCell = document.createElement('td');
        if (perf.coherence) {
            const badge = document.createElement('span');
            badge.className = 'badge';
            badge.textContent = perf.coherence;
            
            if (perf.coherence === 'COHÉRENT') {
                badge.classList.add('badge-coherent');
            } else {
                badge.classList.add('badge-incoherent');
            }
            
            badge.title = `Somme achats: ${perf.somme_achats_kg} kg\nDifférence: ${perf.coherence_difference ? perf.coherence_difference.toFixed(2) : '0'} kg`;
            coherenceCell.appendChild(badge);
        } else {
            coherenceCell.textContent = '-';
        }
        row.appendChild(coherenceCell);
        
        // Actions
        const actionsCell = document.createElement('td');
        
        const editBtn = document.createElement('button');
        editBtn.className = 'btn btn-sm btn-outline-primary mr-1';
        editBtn.innerHTML = '<i class="fas fa-edit"></i>';
        editBtn.title = 'Modifier';
        editBtn.onclick = () => editPerformance(perf);
        actionsCell.appendChild(editBtn);
        
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'btn btn-sm btn-outline-danger';
        deleteBtn.innerHTML = '<i class="fas fa-trash"></i>';
        deleteBtn.title = 'Supprimer';
        deleteBtn.onclick = () => deletePerformance(perf.id);
        actionsCell.appendChild(deleteBtn);
        
        row.appendChild(actionsCell);
        
        // Add click event to show details
        row.style.cursor = 'pointer';
        row.onclick = (e) => {
            // Don't show modal if clicking on buttons
            if (e.target.tagName === 'BUTTON' || e.target.tagName === 'I') return;
            showDetailModal(perf);
        };
        
        tbody.appendChild(row);
    });
}

// Update quick statistics
function updateQuickStats(performances) {
    let total = 0;
    let surestimation = 0;
    let sousEstimation = 0;
    let parfait = 0;
    
    performances.forEach(perf => {
        if (perf.type_estimation) {
            total++;
            if (perf.type_estimation === 'Surestimation') surestimation++;
            else if (perf.type_estimation === 'Sous-estimation') sousEstimation++;
            else if (perf.type_estimation === 'Parfait') parfait++;
        }
    });
    
    document.getElementById('stat-total').textContent = total;
    document.getElementById('stat-surestimation').textContent = surestimation;
    document.getElementById('stat-sous-estimation').textContent = sousEstimation;
    document.getElementById('stat-parfait').textContent = parfait;
}

// Load rankings
async function loadRankings() {
    try {
        let startDate = document.getElementById('filter-start-date').value;
        let endDate = document.getElementById('filter-end-date').value;
        
        // If no dates selected, use default (first day of month to today)
        if (!startDate || !endDate) {
            const today = new Date();
            const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
            startDate = firstDayOfMonth.toISOString().split('T')[0];
            endDate = today.toISOString().split('T')[0];
        }
        
        const params = new URLSearchParams();
        if (startDate) params.append('startDate', startDate);
        if (endDate) params.append('endDate', endDate);
        
        const response = await fetch(`/api/performance-achat/stats?${params.toString()}`, {
            credentials: 'include' // Include session cookies
        });
        const data = await response.json();
        
        if (data.success) {
            displayRankings(data.rankings);
        }
    } catch (error) {
        console.error('Error loading rankings:', error);
    }
}

// Display rankings
function displayRankings(rankings) {
    const container = document.getElementById('rankingContainer');
    
    if (rankings.length === 0) {
        container.innerHTML = '<p class="text-center">Aucun classement disponible</p>';
        return;
    }
    
    container.innerHTML = '';
    
    rankings.forEach((ranking, index) => {
        const rankingDiv = document.createElement('div');
        rankingDiv.className = 'd-flex justify-content-between align-items-center mb-3 p-3 bg-light rounded';
        rankingDiv.style.backgroundColor = 'rgba(255, 255, 255, 0.2)';
        
        const position = index + 1;
        const positionClass = position <= 3 ? `ranking-${position}` : '';
        
        rankingDiv.innerHTML = `
            <div class="d-flex align-items-center">
                <span class="ranking-position ${positionClass}" style="font-size: 2.5rem; min-width: 60px;">#${position}</span>
                <div class="ml-3">
                    <h5 class="mb-0" style="color: #000; font-weight: bold; font-size: 1.3rem;">${ranking.nom}</h5>
                    <small style="color: #333;">
                        ${ranking.total_estimations} estimation${ranking.total_estimations > 1 ? 's' : ''}
                    </small>
                </div>
            </div>
            <div class="text-right">
                <div style="color: #000; font-size: 1.5rem; font-weight: bold;">
                    ${ranking.score_moyen.toFixed(2)}/20
                </div>
                <small style="color: #28a745; font-weight: 600;">
                    Précision: ${ranking.precision_moyenne.toFixed(1)}%
                </small>
                <br>
                <small style="color: #333;">
                    <span style="color: #ffc107; font-weight: 600;">${ranking.total_surestimations} sur</span> | 
                    <span style="color: #17a2b8; font-weight: 600;">${ranking.total_sous_estimations} sous</span>
                </small>
            </div>
        `;
        
        container.appendChild(rankingDiv);
    });
}

// Handle form submit
async function handleFormSubmit(e) {
    e.preventDefault();
    
    const formData = {
        date: document.getElementById('date').value,
        id_acheteur: document.getElementById('acheteur').value,
        bete: document.getElementById('bete').value,
        poids_estime: parseFloat(document.getElementById('poids-estime').value) || null,
        poids_reel: parseFloat(document.getElementById('poids-reel').value) || null,
        commentaire: document.getElementById('commentaire').value || null
    };
    
    try {
        let response;
        if (currentEditId) {
            // Update existing entry
            response = await fetch(`/api/performance-achat/${currentEditId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include', // Include session cookies
                body: JSON.stringify(formData)
            });
        } else {
            // Create new entry
            response = await fetch('/api/performance-achat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include', // Include session cookies
                body: JSON.stringify(formData)
            });
        }
        
        const result = await response.json();
        
        if (result.success) {
            showNotification(result.message, 'success');
            resetForm();
            loadPerformances();
            loadRankings();
        } else {
            showNotification(result.error || 'Erreur lors de l\'enregistrement', 'danger');
        }
    } catch (error) {
        console.error('Error submitting form:', error);
        showNotification('Erreur lors de l\'enregistrement', 'danger');
    }
}

// Handle filter submit
function handleFilterSubmit(e) {
    e.preventDefault();
    
    const filters = {
        startDate: document.getElementById('filter-start-date').value,
        endDate: document.getElementById('filter-end-date').value,
        idAcheteur: document.getElementById('filter-acheteur').value,
        bete: document.getElementById('filter-bete').value
    };
    
    loadPerformances(filters);
    loadRankings();
}

// Edit performance
function editPerformance(perf) {
    currentEditId = perf.id;
    
    document.getElementById('date').value = perf.date;
    document.getElementById('acheteur').value = perf.id_acheteur;
    document.getElementById('bete').value = perf.bete;
    document.getElementById('poids-estime').value = perf.poids_estime || '';
    document.getElementById('poids-reel').value = perf.poids_reel || '';
    document.getElementById('commentaire').value = perf.commentaire || '';
    
    // Show timestamps if available
    if (perf.poids_estime_timestamp) {
        document.getElementById('poids-estime-timestamp').textContent = 
            `Modifié: ${formatTimestamp(perf.poids_estime_timestamp)} par ${perf.poids_estime_updated_by}`;
    }
    if (perf.poids_reel_timestamp) {
        document.getElementById('poids-reel-timestamp').textContent = 
            `Modifié: ${formatTimestamp(perf.poids_reel_timestamp)} par ${perf.poids_reel_updated_by}`;
    }
    
    document.getElementById('cancelEdit').style.display = 'block';
    document.querySelector('#performanceForm button[type="submit"]').innerHTML = 
        '<i class="fas fa-save"></i> Mettre à jour';
    
    // Scroll to form
    document.getElementById('performanceForm').scrollIntoView({ behavior: 'smooth' });
}

// Cancel edit
function cancelEdit() {
    resetForm();
}

// Reset form
function resetForm() {
    currentEditId = null;
    document.getElementById('performanceForm').reset();
    document.getElementById('entry-id').value = '';
    document.getElementById('poids-estime-timestamp').textContent = '';
    document.getElementById('poids-reel-timestamp').textContent = '';
    document.getElementById('cancelEdit').style.display = 'none';
    document.querySelector('#performanceForm button[type="submit"]').innerHTML = 
        '<i class="fas fa-save"></i> Enregistrer';
    
    // Reset date picker to today
    const datePicker = document.getElementById('date')._flatpickr;
    if (datePicker) {
        datePicker.setDate(new Date());
    }
}

// Delete performance
async function deletePerformance(id) {
    if (!confirm('Êtes-vous sûr de vouloir supprimer cette entrée ?')) {
        return;
    }
    
    try {
        const response = await fetch(`/api/performance-achat/${id}`, {
            method: 'DELETE',
            credentials: 'include' // Include session cookies
        });
        
        const result = await response.json();
        
        if (result.success) {
            showNotification('Entrée supprimée avec succès', 'success');
            loadPerformances();
            loadRankings();
        } else {
            showNotification(result.error || 'Erreur lors de la suppression', 'danger');
        }
    } catch (error) {
        console.error('Error deleting performance:', error);
        showNotification('Erreur lors de la suppression', 'danger');
    }
}

// Show detail modal
function showDetailModal(perf) {
    const modalBody = document.getElementById('detailModalBody');
    
    modalBody.innerHTML = `
        <div class="row">
            <div class="col-md-6">
                <h6><i class="fas fa-info-circle"></i> Informations Générales</h6>
                <table class="table table-sm">
                    <tr><th>Date:</th><td>${perf.date}</td></tr>
                    <tr><th>Acheteur:</th><td>${perf.acheteur_nom}</td></tr>
                    <tr><th>Type:</th><td>${perf.bete.charAt(0).toUpperCase() + perf.bete.slice(1)}</td></tr>
                    <tr><th>Créé par:</th><td>${perf.created_by || '-'}</td></tr>
                    <tr><th>Créé le:</th><td>${formatTimestamp(perf.created_at)}</td></tr>
                </table>
            </div>
            <div class="col-md-6">
                <h6><i class="fas fa-weight"></i> Poids</h6>
                <table class="table table-sm">
                    <tr><th>Poids Estimé:</th><td>${perf.poids_estime ? perf.poids_estime.toFixed(2) + ' kg' : '-'}</td></tr>
                    ${perf.poids_estime_timestamp ? `<tr><td colspan="2" class="small text-muted">Modifié: ${formatTimestamp(perf.poids_estime_timestamp)} par ${perf.poids_estime_updated_by}</td></tr>` : ''}
                    <tr><th>Poids Réel:</th><td>${perf.poids_reel ? perf.poids_reel.toFixed(2) + ' kg' : '-'}</td></tr>
                    ${perf.poids_reel_timestamp ? `<tr><td colspan="2" class="small text-muted">Modifié: ${formatTimestamp(perf.poids_reel_timestamp)} par ${perf.poids_reel_updated_by}</td></tr>` : ''}
                </table>
            </div>
        </div>
        <div class="row">
            <div class="col-md-6">
                <h6><i class="fas fa-chart-line"></i> Performance</h6>
                <table class="table table-sm">
                    <tr><th>Écart:</th><td>${perf.ecart !== null ? (perf.ecart >= 0 ? '+' : '') + perf.ecart.toFixed(2) + ' kg' : '-'}</td></tr>
                    <tr><th>Performance:</th><td>${perf.performance !== null ? (perf.performance >= 0 ? '+' : '') + perf.performance.toFixed(2) + '%' : '-'}</td></tr>
                    <tr><th>Type:</th><td>${perf.type_estimation || '-'}</td></tr>
                    <tr><th>Score Pénalisé:</th><td>${perf.score_penalite !== null ? perf.score_penalite.toFixed(2) : '-'}</td></tr>
                </table>
            </div>
            <div class="col-md-6">
                <h6><i class="fas fa-check-circle"></i> Cohérence</h6>
                <table class="table table-sm">
                    <tr><th>Statut:</th><td><span class="badge ${perf.coherence === 'COHÉRENT' ? 'badge-coherent' : 'badge-incoherent'}">${perf.coherence || '-'}</span></td></tr>
                    <tr><th>Somme Achats:</th><td>${perf.somme_achats_kg !== null ? perf.somme_achats_kg.toFixed(2) + ' kg' : '-'}</td></tr>
                    <tr><th>Différence:</th><td>${perf.coherence_difference !== null ? (perf.coherence_difference >= 0 ? '+' : '') + perf.coherence_difference.toFixed(2) + ' kg' : '-'}</td></tr>
                </table>
            </div>
        </div>
        ${perf.commentaire ? `
        <div class="row">
            <div class="col-12">
                <h6><i class="fas fa-comment"></i> Commentaire</h6>
                <p class="border p-2 rounded">${perf.commentaire}</p>
            </div>
        </div>
        ` : ''}
    `;
    
    $('#detailModal').modal('show');
}

// Export to Excel
function exportToExcel() {
    if (allPerformances.length === 0) {
        showNotification('Aucune donnée à exporter', 'warning');
        return;
    }
    
    const exportData = allPerformances.map(perf => ({
        'Date': perf.date,
        'Acheteur': perf.acheteur_nom,
        'Type': perf.bete.charAt(0).toUpperCase() + perf.bete.slice(1),
        'Poids Estimé (kg)': perf.poids_estime || '',
        'Poids Réel (kg)': perf.poids_reel || '',
        'Écart (kg)': perf.ecart !== null ? perf.ecart.toFixed(2) : '',
        'Performance (%)': perf.performance !== null ? perf.performance.toFixed(2) : '',
        'Type Estimation': perf.type_estimation || '',
        'Cohérence': perf.coherence || '',
        'Somme Achats (kg)': perf.somme_achats_kg !== null ? perf.somme_achats_kg.toFixed(2) : '',
        'Commentaire': perf.commentaire || ''
    }));
    
    const worksheet = XLSX.utils.json_to_sheet(exportData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Performance Achat');
    
    const filename = `performance_achat_${new Date().toISOString().split('T')[0]}.xlsx`;
    XLSX.writeFile(workbook, filename);
    
    showNotification('Export Excel réussi', 'success');
}

// Format timestamp (long format)
function formatTimestamp(timestamp) {
    if (!timestamp) return '-';
    const date = new Date(timestamp);
    return date.toLocaleString('fr-FR');
}

// Format timestamp (short format for table)
function formatTimestampShort(timestamp) {
    if (!timestamp) return '-';
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now - date;
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) {
        // Aujourd'hui - afficher l'heure
        return date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    } else if (diffDays === 1) {
        return 'Hier ' + date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    } else if (diffDays < 7) {
        return `Il y a ${diffDays}j`;
    } else {
        // Afficher la date complète
        return date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
    }
}

// Format timestamp with date in YYYY-MM-DD format
function formatTimestampWithDate(timestamp) {
    if (!timestamp) return null;
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now - date;
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    
    // Format date as YYYY-MM-DD
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const dateStr = `${year}-${month}-${day}`;
    
    let timeStr;
    if (diffDays === 0) {
        // Aujourd'hui - afficher l'heure
        timeStr = date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    } else if (diffDays === 1) {
        timeStr = 'Hier ' + date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    } else if (diffDays < 7) {
        timeStr = `Il y a ${diffDays}j - ` + date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    } else {
        timeStr = date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    }
    
    return {
        time: timeStr,
        date: dateStr
    };
}

// Show notification
function showNotification(message, type = 'info') {
    const container = document.getElementById('notificationContainer');
    
    const notification = document.createElement('div');
    notification.className = `alert alert-${type} alert-dismissible fade show`;
    notification.innerHTML = `
        ${message}
        <button type="button" class="close" data-dismiss="alert">
            <span>&times;</span>
        </button>
    `;
    
    container.appendChild(notification);
    
    setTimeout(() => {
        notification.classList.remove('show');
        setTimeout(() => notification.remove(), 300);
    }, 5000);
}

