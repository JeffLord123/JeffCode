# JeffCode — Sous-projet 1 : Fondation

Date : 2026-11-14
Statut : validé en conversation, en attente de relecture

## Contexte

Cursor a retiré son CSS Inspector (panneau Design façon Figma) dans la version 3.12.
JeffCode est un fork de VS Code open source (Code-OSS) destiné à remplacer Cursor pour
un usage de designer UX : navigateur intégré, sélection d'élément, panneau Design/CSS,
console Chrome, et l'extension Claude Code comme seul agent.

Le projet est découpé en deux sous-projets :

1. **Fondation** (ce document) : une application JeffCode qui se lance sur Windows et
   Mac, avec navigateur intégré, extensions via Open VSX et Claude Code.
2. **Mode Design** (spec séparée, à écrire ensuite) : arbre Components, panneau
   Design/CSS, journal des changements, boutons Apply (vers Claude Code) et Copier CSS.

## Objectif

Obtenir une application de bureau autonome nommée JeffCode, installable sur Windows
(x64) et macOS (Apple Silicon et Intel), fonctionnellement équivalente à VS Code 1.146,
avec le navigateur intégré d'upstream actif et l'extension Claude Code installable en
un clic.

## Hors périmètre

- Panneau Design, arbre Components, Apply/Copier (sous-projet 2).
- Mise à jour automatique : les nouvelles versions se téléchargent depuis GitHub Releases.
- Signature de code Windows et notarisation Apple.
- Linux.
- Icône et identité visuelle définitives (l'icône Code-OSS reste provisoirement).
- Suppression du code Copilot/chat d'upstream : il est seulement masqué par défaut.

## Dépôt et branches

- Dépôt : `JeffLord123/JeffCode`, fork public de `microsoft/vscode`.
- Remotes : `origin` = le fork, `upstream` = `microsoft/vscode`.
- `main` : miroir d'upstream, jamais modifié à la main.
- `jeffcode` : branche produit et branche par défaut du dépôt, créée depuis le tag
  stable `1.146.0`.
- Récupération des mises à jour VS Code : `git fetch upstream tag <version>` puis
  `git merge <version>` dans `jeffcode`. Fusion et non rebase, pour ne jamais forcer
  un push.
- Tout le code propre à JeffCode vit dans des dossiers dédiés
  (`src/vs/workbench/contrib/jeffcode/`, plus tard `contrib/jeffDesign/`). Les
  modifications de fichiers upstream sont réduites au strict minimum pour limiter les
  conflits de fusion.

## Identité du produit (`product.json`)

| Champ | Valeur |
|---|---|
| `nameShort`, `nameLong` | `JeffCode` |
| `applicationName` | `jeffcode` |
| `dataFolderName` | `.jeffcode` |
| `sharedDataFolderName` | `.jeffcode-shared` |
| `win32MutexName` | `jeffcode` |
| `win32DirName`, `win32NameVersion` | `JeffCode` |
| `win32RegValueName` | `JeffCode` |
| `win32AppUserModelId` | `JeffLord.JeffCode` |
| `win32ShellNameShort` | `&JeffCode` |
| `win32*AppId` | quatre nouveaux GUID générés |
| `darwinBundleIdentifier` | `com.jefflord.jeffcode` |
| `urlProtocol` | `jeffcode` |
| `reportIssueUrl` | `https://github.com/JeffLord123/JeffCode/issues/new` |

Conséquence voulue : dossiers de données, réglages et extensions séparés de VS Code et
de Cursor. Les trois applications cohabitent sans interférence.

La version dans `package.json` reste celle de VS Code (`1.146.0`), car les extensions
vérifient leur compatibilité sur ce numéro. Les versions de JeffCode sont portées par
les tags Git (`jeffcode-0.1.0`, etc.).

## Extensions

- Marketplace : Open VSX, configuré dans `product.json` :
  - `serviceUrl` : `https://open-vsx.org/vscode/gallery`
  - `itemUrl` : `https://open-vsx.org/vscode/item`
  - `resourceUrlTemplate` : `https://open-vsx.org/vscode/unpkg/{publisher}/{name}/{version}/{path}`
- Limite connue : les extensions propriétaires Microsoft (Pylance, Remote-SSH,
  Live Share, C# Dev Kit) ne sont ni disponibles sur Open VSX ni autorisées hors des
  produits Microsoft.

### Claude Code

- L'extension `anthropic.claude-code` n'est pas embarquée dans l'installeur (elle est
  propriétaire d'Anthropic, on ne la redistribue pas).
- Un petit module `contrib/jeffcode/browser/claudeCodeOnboarding.ts` vérifie au
  démarrage si l'extension est installée. Sinon, il affiche une notification
  « Installer Claude Code » avec trois actions : Installer (installation depuis
  Open VSX), Plus tard, Ne plus demander (choix mémorisé dans le stockage global).
- Si l'installation échoue (réseau, extension retirée d'Open VSX), la notification
  d'erreur propose d'ouvrir la page de l'extension.

## Réglages par défaut

- Fonctions IA intégrées d'upstream (Copilot) masquées par défaut : la valeur par
  défaut du réglage `chat.disableAIFeatures` passe à `true`. Aucun code n'est retiré.
- Télémétrie désactivée par défaut : la valeur par défaut de
  `telemetry.telemetryLevel` passe à `off`.
- Navigateur intégré : dans la version 1.146.0, il est enregistré sans condition
  (aucun réglage ne le masque), donc aucune modification n'est nécessaire. La
  vérification manuelle confirme qu'il reste accessible une fois les fonctions IA
  masquées.

À ce stade, le bouton de sélection d'élément d'upstream envoie l'élément au chat
intégré. Son branchement sur le panneau Design relève du sous-projet 2.

## Environnement de build Windows (ce PC)

Constaté le 2026-11-14 :

| Prérequis | Requis | État |
|---|---|---|
| Node.js | 24.22.1 (`.nvmrc`) | 22.16.0 installé : installer la 24.22.1 en parallèle via un gestionnaire de versions |
| Visual Studio Build Tools 2022, charge C++ | oui | présent |
| Bibliothèques C++ avec atténuation Spectre | oui | absentes : à ajouter via Visual Studio Installer (demande une élévation administrateur) |
| Python | 3.x | 3.14.0 présent |
| Git | oui | 2.51.1 présent |

Commandes de travail : `npm ci`, puis `npm run watch` et `scripts\code.bat` pour
lancer la version de développement. Le paquet installable se produit avec les tâches
gulp de packaging Windows x64 d'upstream.

## Intégration continue et distribution

- Les workflows GitHub Actions d'upstream sont supprimés : ils dépendent de
  l'infrastructure Microsoft et n'ont pas d'utilité ici.
- Un workflow unique `.github/workflows/jeffcode-release.yml`, déclenché par un tag
  `jeffcode-*` ou manuellement, avec trois jobs :
  - Windows x64 : installeur utilisateur `.exe` et archive `.zip`.
  - macOS arm64 : archive `.zip` de `JeffCode.app`.
  - macOS x64 : archive `.zip` de `JeffCode.app`.
- Les applications macOS reçoivent une signature ad hoc (`codesign -s -`), obligatoire
  pour qu'une application arm64 démarre.
- Sur tag, les fichiers sont attachés à une GitHub Release. En déclenchement manuel,
  ils sont disponibles comme artefacts du workflow.
- Premier lancement sur Mac, l'application n'étant pas notarisée : clic droit puis
  Ouvrir, ou `xattr -cr /Applications/JeffCode.app`. Cette consigne figure dans le
  README et dans les notes de chaque Release.

## Documentation

Le `README.md` d'upstream est remplacé par un README JeffCode court : ce qu'est le
projet, comment installer sur Windows et Mac, comment installer Claude Code, comment
compiler, comment récupérer une nouvelle version de VS Code.

## Gestion des erreurs

- Open VSX indisponible : la vue Extensions affiche l'erreur réseau standard d'upstream,
  l'application reste utilisable.
- Échec d'un job de build : le workflow échoue sans publier de Release partielle (la
  Release n'est créée que si les trois jobs réussissent).

## Vérification

Tests automatiques :

- Test unitaire du module d'onboarding Claude Code : extension déjà installée (pas de
  notification), extension absente (notification), choix « Ne plus demander » respecté.
- Les tests unitaires d'upstream liés aux fichiers modifiés continuent de passer.

Vérification manuelle, sur Windows puis sur Mac :

1. JeffCode se lance, le titre de fenêtre et le menu affichent « JeffCode ».
2. Les données sont dans `.jeffcode`, VS Code et Cursor ne sont pas affectés.
3. La vue Extensions liste les extensions d'Open VSX ; installation d'une extension
   courante (Prettier) réussie.
4. La notification Claude Code apparaît ; l'installation et la connexion au compte
   fonctionnent ; l'agent répond.
5. Le navigateur intégré ouvre `https://www.google.com` et une page `localhost`.
6. La sélection d'élément fonctionne ; les DevTools s'ouvrent avec DOM, CSS et console.
7. Le workflow de release produit les trois fichiers ; l'application Mac téléchargée
   démarre.

## Critère de réussite

Les sept points de vérification manuelle passent sur le PC Windows, et les points 1 à 6
passent sur le Mac avec l'application produite par le workflow.
