# JeffCode — Outils design du navigateur intégré

Date : 2026-11-18
Statut : implémenté, vérifié en local (Windows) ; à valider par Geoffrey

## Demande

1. Un bouton pour ouvrir le navigateur intégré à côté des boutons design (plus de `Ctrl+Shift+P`).
2. Un mode miroir : à gauche le site du dernier commit, à droite le site avec les changements non commités, fonctionnel et pas seulement visuel. Sans changement non commité, rien à droite.
3. Des règles graduées comme dans Figma, d'où l'on tire des guides sur la page.
4. Un outil Mesure : afficher d'un clic les mesures (gap, padding, composants…, au choix dans un sous-menu), et comme dans Figma, accrocher le curseur aux bords des éléments et tirer des mesures depuis un bord.

## Ce qui est fait

- **Barre du navigateur** : un groupe dédié aux outils design, avant les outils d'origine : globe (nouvel onglet de navigateur), Design Panel, sélection d'élément, Règles, Mesure ▾, Mode miroir ▾. Le bouton « Integrated Browser » de la barre de titre est désormais toujours visible, même sans navigateur ouvert (réglage `workbench.browser.showInTitleBar`, par défaut `true` dans JeffCode).
- **Règles** : règles en haut et à gauche, en pixels CSS de la page, qui suivent le défilement, le zoom et l'émulation d'appareil. Glisser depuis une règle crée un guide ; un guide se déplace à la souris, se supprime en le ramenant sur sa règle ou avec Suppr au survol. Clic droit sur une règle : « Clear Guides ». L'élément survolé avec l'outil Mesure est surligné sur les règles, comme la sélection dans Figma.
- **Mesure** : au survol, contour de l'élément, taille `L × H` et distances aux voisins et au parent. Le curseur s'accroche aux bords (6 px) ; glisser depuis un bord tire une mesure qui s'accroche au bord parallèle le plus proche (ou à un guide) et reste posée. Les mesures posées suivent l'élément si la mise en page change (par exemple depuis le Design Panel) ; au survol de leur étiquette, on les déplace ou on les supprime. Le sous-menu coche ce qui s'affiche sur tous les éléments visibles : Gaps et Padding (par défaut), Margins, Components and Sizes (noms React/Vue/Angular/composants web, sinon éléments interactifs), Font Sizes ; et « Clear Placed Measurements ». Pendant la mesure, les clics n'atteignent pas la page ; le survol et le défilement, oui. Échap quitte l'outil.
- **Mode miroir** : le côté droit est l'onglet courant (serveur de développement local ou page `file:` du dépôt). JeffCode crée (ou met à jour) un worktree git du dernier commit dans `~/.jeffcode/mirror/<dépôt>-<hash>`, y copie les fichiers `.env*` ignorés par git, installe les dépendances seulement si le lockfile a changé, puis lance la même commande que le site sur un port libre, dans un terminal « JeffCode Mirror: last commit ». La commande est reprise du terminal qui affiche l'adresse du site ; sinon elle est devinée depuis `package.json` et demandée une fois (préremplie), puis mémorisée ; une commande modifiée à la main (sous-menu) est prioritaire sur celle du terminal, et la valider relance la copie même pendant son démarrage. Sous Linux, macOS et WSL, nvm est chargé s'il est installé et la version de Node du projet est activée (`.nvmrc`, `.node-version`, sinon la version majeure de `engines.node`), pour l'installation comme pour le serveur. Le port est passé par `PORT` et, pour les outils connus (Vite, Next, Astro, Nuxt, Angular, webpack…, Django, Rails, PHP…), par leur option de port. Le côté gauche s'ouvre dans un groupe verrouillé et affiche la progression jusqu'à ce que le site réponde. Navigation et défilement synchronisés dans les deux sens. Sans changement non commité, la page de droite est recouverte par « No uncommitted changes », qui disparaît dès qu'un fichier change. Un nouveau commit met la copie à jour (et la relance si les dépendances changent). Badges « Last commit abc1234 » / « Uncommitted » devant l'adresse. Arrêt : le bouton, ou fermer un des deux onglets ; la copie reste sur disque pour un redémarrage rapide.

## Architecture

Rien ne peut être dessiné par-dessus la page, qui est une vue native : les guides, mesures et le recouvrement du miroir sont dessinés par un script injecté dans la page via le Chrome DevTools Protocol (un canvas dans un shadow root fermé, créé seulement quand il sert, et après le chargement pour ne pas gêner l'hydratation React/Next). Aucun fichier d'upstream modifié.

| Fichier | Rôle |
|---|---|
| `common/designOverlay.ts` | Protocole page ↔ JeffCode, validation des messages de la page. Testé. |
| `common/designRulerTicks.ts` | Graduations des règles. Testé. |
| `common/designMirrorCommand.ts` | Commandes, ports, adresses et chemins du miroir. Testé. |
| `electron-browser/designOverlayScript.ts` | Script exécuté dans la page : guides, outil Mesure, annotations, recouvrement. Autonome (vérifié après minification). |
| `electron-browser/designPageOverlay.ts` | Pont CDP par page : injection, état, notifications ; préférences de mesure. |
| `electron-browser/designRulers.ts` | Règles (canvas) et glisser-déposer des guides. |
| `electron-browser/designOverlayContribution.ts` | Règles et Mesure dans l'éditeur navigateur, actions et sous-menu. |
| `electron-browser/designMirrorService.ts` | Orchestration du mode miroir (worktree, dépendances, serveur, synchro). |
| `electron-browser/designMirrorContribution.ts` | Progression du côté gauche et badges. |
| `electron-browser/designMirrorActions.ts` | Bouton Mode miroir et son sous-menu. |
| `electron-browser/designToolbar.ts` | Groupe, ordre des boutons, menus et clés de contexte partagés. |

## Limites connues

- Mode miroir : prévu pour un serveur de développement local (`localhost`, `127.x`, réseau privé) ou une page `file:` du dépôt. Les sessions stockées en `localStorage` ne sont pas partagées entre les deux ports (les cookies le sont). Un serveur qui refuse tout autre port que le sien sans le dire demande d'entrer l'adresse à la main (bouton prévu). En demi-largeur, les boutons design passent dans le menu « … » de la barre.
- Les mesures et guides ne voient pas l'intérieur des iframes.
- Les mesures posées ne survivent pas à un rechargement de la page ; les guides si.
- Textes de l'interface en anglais, comme le reste de JeffCode.

## Vérification

- Tests unitaires : `designOverlay.test.ts`, `designRulerTicks.test.ts`, `designMirrorCommand.test.ts` (35 tests jeffDesign au total, tous verts). Vérification de types et lint sans erreur (hors règle d'en-tête de copyright, comme les autres fichiers JeffCode).
- Vérification manuelle le 2026-11-18 sur une instance de développement pilotée par CDP, avec un petit site et un dépôt git de test : boutons et sous-menus, globe de la barre de titre ; règles, deux guides tirés depuis les règles ; mesures automatiques (gaps, paddings), survol avec distances et taille, mesure tirée entre deux boutons (12 px), clics bloqués pendant la mesure, Échap ; règles après rechargement de la page ; mode miroir complet : commande proposée, copie du dernier commit lancée sur un autre port, différence de couleur et de comportement entre les deux côtés, défilement synchronisé, recouvrement « No uncommitted changes » après annulation des modifications, arrêt (onglet et serveur fermés).
- Non vérifié : macOS, espaces de travail distants (WSL/SSH), vrais projets Vite/Next (le comportement repose sur l'adresse que le serveur affiche, prise en charge par les tests unitaires).
