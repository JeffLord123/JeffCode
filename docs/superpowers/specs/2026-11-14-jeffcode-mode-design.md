# JeffCode — Sous-projet 2 : Mode Design

Date : 2026-11-14
Statut : première version implémentée ; à ajuster après les tests de Geoffrey

## Objectif

Retrouver dans JeffCode l'ancien CSS Inspector de Cursor : sélectionner un élément dans le
navigateur intégré, modifier son design avec des contrôles façon Figma, voir le résultat en
direct, puis envoyer les changements à Claude Code qui les reporte dans le code source.

## Ce que fait la première version

- **Barre du navigateur** : deux boutons. « Design Panel » ouvre ou ferme le panneau.
  « Select Element to Design » (`Ctrl+Shift+C`) active la sélection au clic dans la page.
- **Panneau**, à droite de la page (300 px) :
  - **Components** : arbre des éléments de la page, repliable. Survol = surlignage dans la
    page, clic = sélection, flèches du clavier pour naviguer.
  - **Onglet Design** : Flow (ligne, colonne, retour à la ligne, grille, espacement,
    alignements), Dimensions, Padding, Margin (par axe ou par côté), Clip content,
    Border box, Appearance (opacité, rayon global ou par coin), Text (police, graisse,
    taille, interligne, espacement des lettres, alignement, couleur), Background, Border.
  - **Onglet CSS** : style en ligne et règles d'auteur qui s'appliquent à l'élément, avec
    le fichier source. Valeurs éditables, ajout et suppression de déclarations.
  - **Barre du bas** : nombre de changements, Reset, Copy CSS, Apply.
- **Champs numériques** : saisie, flèches haut/bas (Maj = ×10), glisser l'icône du champ
  pour faire défiler la valeur. Une valeur refusée par le navigateur est ignorée.
- **Journal** : chaque changement est enregistré par élément (sélecteur, balise, texte,
  composants React ou Vue quand ils sont détectables, propriété, avant → après). Revenir à
  la valeur d'origine retire l'entrée.
- **Copy CSS** : copie les changements en règles CSS, avec l'ancienne valeur en commentaire.
- **Apply** : ouvre Claude Code avec un prompt pré-rempli qui décrit les changements.
  Le prompt n'est pas envoyé automatiquement. Si Claude Code n'est pas installé, le prompt
  est copié dans le presse-papier.
- **Rechargement de la page** : les aperçus sont réappliqués aux éléments retrouvés par
  sélecteur. Ceux qui ne sont plus trouvés sont signalés dans la barre du bas.

## Architecture

Tout le code est dans `src/vs/workbench/contrib/jeffDesign/`. Les seuls fichiers
d'upstream touchés sont `workbench.desktop.main.ts` (une ligne d'import).

| Fichier | Rôle |
|---|---|
| `common/designCss.ts` | Lecture et écriture de longueurs et de couleurs CSS. Pur, testé. |
| `common/designChanges.ts` | Journal des changements, regroupement en raccourcis CSS, sortie CSS et prompt. Pur, testé. |
| `electron-browser/designCdpSession.ts` | Session Chrome DevTools Protocol attachée à la page, via le service `IBrowserViewCDPService` d'upstream. |
| `electron-browser/designInspector.ts` | Arbre DOM, sélection au clic (`Overlay.setInspectMode`), lecture des styles, application des aperçus en style en ligne, journal. |
| `electron-browser/designControls.ts` | Champs réutilisables : nombre, couleur, liste, segments, case à cocher. |
| `electron-browser/designSections.ts` | Sections de l'onglet Design. |
| `electron-browser/designCssView.ts` | Onglet CSS. |
| `electron-browser/designTreeView.ts` | Arbre Components. |
| `electron-browser/designPanel.ts` | Assemblage du panneau, Copy CSS, Apply. |
| `electron-browser/jeffDesign.contribution.ts` | Branchement dans l'éditeur navigateur (contribution `BrowserEditorContribution`), boutons et raccourci. |

Les aperçus sont des styles en ligne posés sur l'élément. Les valeurs en ligne d'origine
sont mémorisées par propriété pour que Reset les restitue exactement.

Apply appelle la commande `claude-vscode.editor.open` de l'extension Claude Code avec le
prompt en second argument.

## Limites connues

- Après Apply, le journal est vidé mais les aperçus restent dans la page jusqu'à son
  rechargement. Si Claude applique mal un changement, l'aperçu le masque tant que la page
  n'est pas rechargée.
- Le journal est lié à l'onglet navigateur ouvert : changer de page dans le même onglet
  d'éditeur ou recharger la fenêtre JeffCode le vide (les aperçus restent dans la page).
- Les éléments dans une iframe ou un shadow DOM n'apparaissent pas dans l'arbre.
- Les états `:hover`, `:focus` et les points de rupture responsive ne sont pas éditables.
- Largeur du panneau fixe.
- Une notification affichée par-dessus la page met le navigateur en pause (comportement
  d'upstream) ; le panneau évite donc les notifications pour les actions courantes.
- Textes de l'interface en anglais, non traduits.

## Vérification

- Tests unitaires : `designCss.test.ts`, `designChanges.test.ts` (17 tests).
- Vérification manuelle faite le 2026-11-14 sur une page de test locale, en pilotant une
  instance de développement : sélection au clic et par l'arbre, lecture des valeurs,
  édition par saisie, flèches et glissement, valeur invalide ignorée, couleur avec opacité,
  Flow, onglet CSS, Copy CSS, réapplication après rechargement de la page, Reset, Apply
  vers Claude Code, ouverture et fermeture du panneau, deux rechargements de fenêtre.
- Non vérifié : macOS, pages avec React/Vue réels, très grosses pages.
