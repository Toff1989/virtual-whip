# 🪢 Virtual Whip (Fouet Virtuel)

[English](README.md) | **Français**

[![CI](https://github.com/Toff1989/virtual-whip/actions/workflows/ci.yml/badge.svg)](https://github.com/Toff1989/virtual-whip/actions/workflows/ci.yml)
[![Licence MIT](https://img.shields.io/badge/licence-MIT-blue.svg)](LICENSE)
![Plateforme](https://img.shields.io/badge/plateforme-Windows-0078D6.svg)
![VS Code](https://img.shields.io/badge/VS%20Code-%E2%89%A5%201.93-007ACC.svg)

Ton IA réfléchit trop longtemps ? **Claque un fouet virtuel à l'écran** : un geste sec de la
souris fait claquer le fouet (son + éclat), interrompt le travail en cours de Claude Code ou
de Copilot Chat, et lui envoie un message pour qu'il aille plus vite. Sans jamais changer le
focus de VS Code.

<p align="center">
  <img src="docs/presets/leather.png" alt="Le fouet en cuir, avec son point d'ancrage et l'éclat du claquement" width="640">
</p>

## Fonctionnalités

- **Un vrai fouet à l'écran** : corde simulée par une petite physique (gravité, inertie), fixée
  à un point d'ancrage et qui suit ton curseur, dans la limite d'une **longueur maximale**.
- **Point d'ancrage déplaçable** : clic gauche maintenu sur le rond, déplacement, relâchement.
  La position est mémorisée.
- **Claquement au geste** : un mouvement de poignet assez rapide déclenche le son et l'éclat.
- **Envoi direct à l'IA, sans toucher au focus** :
  - **terminal Claude Code** : `Échap` interrompt le tour en cours, puis le message part ;
  - **chat Copilot** : « arrêter et envoyer », sans voler le focus ni écraser ton brouillon.
- **Très personnalisable** : 6 styles prédéfinis et une quinzaine de réglages (couleurs,
  épaisseur, halo, physique, effet, son, comportement).
- **Léger et sans dépendance** : un petit exécutable Windows natif (~30 Ko), rien à installer
  de plus. Le fouet ne s'affiche que quand VS Code a le focus et laisse passer tous les clics,
  sauf sur le point d'ancrage.

## Installation

Windows 10/11 et VS Code 1.93 ou plus.

**Le plus simple** : télécharge `install-virtual-whip.bat` depuis la page
[Releases](https://github.com/Toff1989/virtual-whip/releases) et double-clique dessus. C'est un
installeur en un seul fichier, sans prérequis (ni Node, ni compilateur) : il installe
l'extension dans VS Code, VS Code Insiders et/ou VSCodium, puis se nettoie.

| Commande | Effet |
|---|---|
| `install-virtual-whip.bat` | installe ou met à jour l'extension |
| `install-virtual-whip.bat uninstall` | la désinstalle |
| `install-virtual-whip.bat /s` | mode silencieux (pas de pause finale) |

**Autres façons** : télécharge le `.vsix` des Releases puis *Extensions → … → Installer à partir
de VSIX…*, ou compile depuis les sources (voir [Développement](#développement)).

## Démarrage rapide

1. Redémarre VS Code, puis clique sur **« Fouet inactif »** dans la barre d'état
   (ou `Ctrl+Alt+F`) pour afficher le fouet.
2. Lance Claude Code dans un terminal VS Code (ou ouvre le chat Copilot et clique une fois dans
   son champ de saisie).
3. Fais un **geste sec de la souris** : le fouet claque et le message part.

Le son intégré est utilisé par défaut ; tu peux en choisir un autre (`virtualWhip.audioFilePath`).

L'interface s'affiche en français si VS Code est en français ; les messages envoyés à l'IA sont en
anglais par défaut (modifiables avec `virtualWhip.messages`).

## Personnalisation

Ouvre les paramètres (`Ctrl+,`) et cherche **« virtualWhip »** : les réglages sont regroupés en
sections. La commande **Virtual Whip: Choisir un style** propose les styles prédéfinis.

### Styles prédéfinis (`virtualWhip.appearance.preset`)

| | | |
|:---:|:---:|:---:|
| <img src="docs/presets/leather.png" width="250"><br>**Cuir** (défaut) | <img src="docs/presets/neon.png" width="250"><br>**Néon** | <img src="docs/presets/fire.png" width="250"><br>**Feu** |
| <img src="docs/presets/ice.png" width="250"><br>**Glace** | <img src="docs/presets/gold.png" width="250"><br>**Or** | <img src="docs/presets/shadow.png" width="250"><br>**Ombre** |

Chaque réglage d'apparence que tu modifies **prend le pas sur le style** ; ceux que tu n'as pas
touchés suivent le style. *Virtual Whip: Réinitialiser l'apparence* remet tout à zéro.

```jsonc
{
  "virtualWhip.appearance.preset": "neon",
  "virtualWhip.whip.thickness": 9,       // corde plus épaisse
  "virtualWhip.maxLength": 600,          // fouet plus long
  "virtualWhip.effect.color": "#ff4d94", // éclat rose
  "virtualWhip.sound.volume": 60
}
```

### Tous les réglages

**Général**

| Réglage | Défaut | Rôle |
|---|---|---|
| `virtualWhip.autoStart` | `false` | affiche le fouet au démarrage de VS Code |
| `virtualWhip.showOnlyWhenFocused` | `true` | masque le fouet quand VS Code n'a pas le focus |
| `virtualWhip.sensitivity` | `3.5` | vitesse minimale du geste (px/ms) ; plus haut = moins sensible |
| `virtualWhip.cooldownMs` | `650` | délai minimal entre deux claquements |
| `virtualWhip.maxLength` | `450` | longueur maximale du fouet (px) |
| `virtualWhip.anchorPosition` | `bottom-right` | coin de départ du point d'ancrage |

**Envoi des messages**

| Réglage | Défaut | Rôle |
|---|---|---|
| `virtualWhip.messages` | 6 messages | textes envoyés au hasard *(paramètres utilisateur uniquement)* |
| `virtualWhip.target` | `auto` | `auto`, `claude` ou `copilot` *(paramètres utilisateur uniquement)* |
| `virtualWhip.interruptBeforeSend` | `true` | interrompt le travail en cours avant d'envoyer |
| `virtualWhip.interruptDelayMs` | `200` | délai entre l'interruption et le message (terminal) |
| `virtualWhip.reasoningEffort` | `unchanged` | `low` / `medium` / `high` : envoie `/effort` à Claude Code |

**Apparence du fouet**

| Réglage | Défaut | Rôle |
|---|---|---|
| `virtualWhip.appearance.preset` | `leather` | style prédéfini |
| `virtualWhip.whip.colorBase` / `colorTip` | `#785032` / `#D2A064` | dégradé de la base au bout |
| `virtualWhip.whip.opacity` | `0.9` | opacité (0.1 à 1) |
| `virtualWhip.whip.thickness` / `tipThickness` | `7` / `2` | épaisseur à la base et au bout (px) |
| `virtualWhip.whip.glow` | `0` | intensité du halo (0 à 1) |
| `virtualWhip.whip.gravity` | `0.35` | poids de la corde (0 = elle flotte) |
| `virtualWhip.whip.damping` | `0.985` | inertie (proche de 1 = elle oscille longtemps) |

**Point d'ancrage et effet de claquement**

| Réglage | Défaut | Rôle |
|---|---|---|
| `virtualWhip.anchor.color` / `size` | `#3C2D1E` / `9` | couleur et rayon du point d'ancrage |
| `virtualWhip.effect.enabled` | `true` | affiche l'éclat au bout du fouet |
| `virtualWhip.effect.color` | `#FFE6B4` | couleur de l'éclat |
| `virtualWhip.effect.size` | `1` | taille de l'éclat (0.3 à 3) |
| `virtualWhip.effect.durationMs` | `380` | durée de l'éclat |
| `virtualWhip.effect.rays` | `8` | nombre de rayons (0 = onde seule) |

**Son**

| Réglage | Défaut | Rôle |
|---|---|---|
| `virtualWhip.audioFilePath` | vide | `.wav` ou `.mp3` ; vide = son intégré ; `${workspaceFolder}` accepté |
| `virtualWhip.sound.volume` | `100` | de 0 (muet) à 100 |

### Commandes

| Commande (VS Code en français) | Rôle |
|---|---|
| `Virtual Whip: Afficher/Masquer le fouet` (`Ctrl+Alt+F`) | active ou désactive le fouet |
| `Virtual Whip: Claquer maintenant (test)` | déclenche un claquement sans geste |
| `Virtual Whip: Choisir un style` | choisit un style prédéfini |
| `Virtual Whip: Réinitialiser l'apparence` | remet le style et les couleurs par défaut |
| `Virtual Whip: Réinitialiser la position du point d'ancrage` | ramène l'ancrage à son coin |

## Où part le message

| `virtualWhip.target` | Comportement |
|---|---|
| `auto` (défaut) | terminal Claude Code s'il est détecté, sinon chat Copilot |
| `claude` | uniquement le terminal Claude Code (à défaut de détection, le terminal actif) |
| `copilot` | uniquement le chat Copilot |

- **Terminal Claude Code** : détecté quand une commande `claude` y est lancée (ou si le nom du
  terminal contient « claude »). Le message est tapé avec `sendText`, sans `terminal.show`, donc
  sans toucher au focus ni au panneau visible.
- **Chat Copilot** : commande interne `workbench.action.chat.submit` avec `preserveFocus` et
  `preserveInput` ; le chat doit avoir été cliqué au moins une fois dans la fenêtre.
- **Interruption** (`virtualWhip.interruptBeforeSend`) : sans elle, le message serait mis en file
  d'attente jusqu'à la fin du tour du modèle. Terminal : touche `Échap` avant le message (jamais
  deux `Échap` à moins de 1,5 s, ce qui déclencherait « rewind »). Copilot : « arrêter et envoyer ».
- **Niveau de réflexion** (`virtualWhip.reasoningEffort`, désactivé par défaut) : terminal Claude
  Code uniquement. ⚠️ Claude Code enregistre ce niveau comme défaut du modèle ; `/effort auto` le
  rétablit.

## Limites connues

- **Windows uniquement** (fenêtre transparente native, son via l'API multimédia de Windows).
- Le **chat de l'extension Claude Code** n'est pas supporté (son API permet seulement de
  préremplir le champ, sans envoyer). Active son réglage `claudeCode.useTerminal` : il passe alors
  par un terminal, que le fouet gère.
- Le niveau de réflexion ne s'applique pas au chat Copilot (aucune API publique).
- Le clic sur le point d'ancrage dépend de Windows : si le glisser ne démarre pas, un filet de
  sécurité détecte l'appui sur le rond, mais le clic peut alors aussi atteindre la fenêtre dessous.
- L'extension n'est pas publiée sur le Marketplace (éditeur `local`) : installation par les
  Releases.

## Dépannage

| Symptôme | Piste |
|---|---|
| Rien ne s'affiche | la fenêtre VS Code doit avoir le focus (ou désactive `virtualWhip.showOnlyWhenFocused`) ; regarde *Affichage → Sortie → Virtual Whip* |
| « overlay non compilé » | lance `npm run compile` (installation depuis les sources) |
| Le fouet claque trop facilement | augmente `virtualWhip.sensitivity` (essaie 6 à 8 sur un grand écran) |
| Le message ne part pas | vérifie `virtualWhip.target` ; pour Copilot, clique une fois dans le champ du chat |
| Pas de son | `virtualWhip.sound.volume` > 0 ; un `.mp3` doit être lisible par Windows |

## Développement

Prérequis : Windows, Node.js 20+, VS Code. Le compilateur C# (`csc.exe`, .NET Framework 4) est
déjà présent dans Windows.

```bash
npm ci                 # dépendances
npm run compile        # extension (TypeScript) + overlay natif (C#)
npm test               # tests (apparence, réglages, traductions, extension)
```

Puis **F5** dans VS Code lance une fenêtre « Extension Development Host » avec l'extension.

| Script | Rôle |
|---|---|
| `npm run compile` | compile tout (recopie aussi `VERSION.txt` dans `package.json`) |
| `npm run watch` | recompile le TypeScript en continu |
| `npm test` | tests unitaires (`node --test`) |
| `npm run package` | compile, produit le `.vsix` et l'installeur `install-virtual-whip.bat` |
| `node scripts/make-gallery.js` | régénère `docs/presets/*.png` et `assets/icon.png` |
| `node scripts/make-default-sound.js` | régénère le son intégré `assets/crack.wav` |

**Numéro de version** : il n'est écrit que dans [`VERSION.txt`](VERSION.txt). `npm run compile`
le recopie dans `package.json` et `package-lock.json` (exigés par `vsce`).

**Langues** : l'anglais est la langue source ; le français est fourni par `package.nls.fr.json`
et `l10n/bundle.l10n.fr.json`. Voir [CONTRIBUTING.md](CONTRIBUTING.md) (en anglais).

Le code, les commentaires et les autres documents (`CONTRIBUTING`, `CHANGELOG`, `SECURITY`) sont
en anglais.

## Licence

[MIT](LICENSE)
