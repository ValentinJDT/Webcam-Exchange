# WebcamExchange

WebcamExchange est une application mobile permettant d'utiliser un ou plusieurs appareils comme appareils photo externes pour un autre appareil. Les appareils clients prennent des photos et les envoient automatiquement à un appareil serveur, qui reçoit et stocke toutes les images. Une galerie permet de visualiser les photos reçues sur le serveur.

## Fonctionnalités principales
- Prise de photos sur un ou plusieurs appareils clients et envoi automatique vers un appareil serveur
- Mode serveur (réception) et client (prise de vue et envoi) TCP
- Visualisation des photos reçues dans une galerie sur le serveur
- Interface utilisateur moderne et intuitive

## Prérequis
- Node.js (version recommandée : 16 ou supérieure)
- npm ou yarn
- Android Studio (pour le build Android)
- Java JDK 11 ou supérieur

## Installation et démarrage en mode développement

1. **Cloner le dépôt**
	```bash
	git clone <url-du-repo>
	cd WebcamExchange
	```

2. **Installer les dépendances**
	```bash
	npm install
	# ou
	yarn install
	```

3. **Lancer le projet en mode développement**
	- **Android** :
	  ```bash
	  npx react-native run-android
	  ```
	- **iOS** (nécessite un Mac) :
	  ```bash
	  npx pod-install
	  npx react-native run-ios
	  ```

## Build de l'application Android (release)

Pour générer un APK de production Android :

1. Aller dans le dossier `android` :
	```bash
	cd android
	```
2. Lancer la commande de build :
	```bash
	./gradlew assembleRelease
	```

L'APK généré se trouvera dans `android/app/build/outputs/apk/release/`.

## Structure du projet
- `screens/` : Écrans principaux de l'application (App, Client, Serveur, Galerie)
- `components/` : Composants réutilisables (InfoBox, LogViewer, SideNavBar)
- `utils/` : Fonctions utilitaires
- `styles/` : Styles communs
- `android/` et `ios/` : Projets natifs Android et iOS

## Tests
Pour lancer les tests unitaires :
```bash
npm test
# ou
yarn test
```

## Licence
Ce projet est sous licence MIT.
