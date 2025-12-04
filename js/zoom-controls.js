/**
 * Contrôles de zoom pour l'interface
 */

(function() {
    'use strict';
    
    // Éléments du DOM
    const zoomIndicator = document.getElementById('zoom-indicator');
    const zoomLevelSpan = document.getElementById('zoom-level');
    
    // Niveau de zoom actuel
    let currentZoom = 100;
    
    /**
     * Met à jour l'affichage du niveau de zoom
     */
    function updateZoomDisplay() {
        if (zoomLevelSpan) {
            zoomLevelSpan.textContent = currentZoom + '%';
        }
    }
    
    /**
     * Détecte le niveau de zoom du navigateur
     */
    function detectBrowserZoom() {
        const zoom = Math.round(window.devicePixelRatio * 100);
        if (zoom !== currentZoom) {
            currentZoom = zoom;
            updateZoomDisplay();
        }
    }
    
    // Initialisation
    if (zoomIndicator) {
        // Cacher l'indicateur par défaut (optionnel)
        zoomIndicator.style.display = 'none';
    }
    
    // Détecter le zoom initial
    detectBrowserZoom();
    
    // Écouter les changements de taille de fenêtre (peut indiquer un changement de zoom)
    window.addEventListener('resize', detectBrowserZoom);
})();

